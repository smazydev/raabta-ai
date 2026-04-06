import { z } from "zod";

export const INTERNAL_KEYS = [
  "block_card",
  "freeze_card",
  "create_complaint",
  "append_live_event",
  "resolve_conversation",
  "escalate_conversation",
] as const;
export type InternalKey = (typeof INTERNAL_KEYS)[number];

export const PLACEHOLDER_KEYS = [
  "cardId",
  "customerId",
  "conversationId",
  "callId",
  "tenantId",
] as const;

const positionSchema = z.object({ x: z.number(), y: z.number() }).optional();

const triggerManualNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("trigger_manual"),
  name: z.string().optional(),
  position: positionSchema,
  config: z.record(z.unknown()).optional(),
});

const internalNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("internal"),
  name: z.string().optional(),
  position: positionSchema,
  config: z.object({
    internal_key: z.enum(INTERNAL_KEYS),
    category: z.string().optional(),
    event_type: z.string().optional(),
    containment: z.boolean().optional(),
    summary: z.string().optional(),
  }),
});

const httpRequestNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("http_request"),
  name: z.string().optional(),
  position: positionSchema,
  config: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH"]),
    path_template: z.string().min(1),
    body_template: z.record(z.unknown()).optional(),
  }),
});

const noopNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("noop"),
  name: z.string().optional(),
  position: positionSchema,
  config: z.record(z.unknown()).optional(),
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  triggerManualNodeSchema,
  internalNodeSchema,
  httpRequestNodeSchema,
  noopNodeSchema,
]);

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** Returns executable nodes in order (excludes trigger_manual). Throws if not a single linear chain from trigger. */
export function resolveLinearExecutionOrder(def: WorkflowDefinition): WorkflowNode[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const triggers = def.nodes.filter((n) => n.type === "trigger_manual");
  if (triggers.length !== 1) {
    throw new Error("Workflow must have exactly one trigger_manual node");
  }
  const triggerId = triggers[0].id;
  const outgoing = new Map<string, string>();
  for (const e of def.edges) {
    if (outgoing.has(e.source)) {
      throw new Error(`Non-linear workflow: node "${e.source}" has multiple outgoing edges`);
    }
    outgoing.set(e.source, e.target);
  }

  const executableIds = new Set(
    def.nodes.filter((n) => n.type !== "trigger_manual").map((n) => n.id)
  );

  const order: WorkflowNode[] = [];
  let cur = triggerId;
  const visited = new Set<string>();

  while (outgoing.has(cur)) {
    const nextId = outgoing.get(cur)!;
    if (visited.has(nextId)) throw new Error("Workflow graph contains a cycle");
    visited.add(nextId);
    const node = byId.get(nextId);
    if (!node) throw new Error(`Edge references unknown node "${nextId}"`);
    if (node.type !== "trigger_manual") {
      order.push(node);
    }
    cur = nextId;
  }

  if (order.length !== executableIds.size) {
    throw new Error(
      "Linear path from trigger does not reach all action nodes — check edges"
    );
  }
  const seen = new Set(order.map((n) => n.id));
  for (const id of executableIds) {
    if (!seen.has(id)) throw new Error(`Unreachable node "${id}"`);
  }

  return order;
}

export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(raw);
}

export const defaultWorkflowDefinition = (): WorkflowDefinition => ({
  nodes: [
    { id: "trigger_1", type: "trigger_manual", name: "Start" },
    { id: "step_1", type: "noop", name: "Placeholder" },
  ],
  edges: [
    { source: "trigger_1", target: "step_1" },
  ],
});
