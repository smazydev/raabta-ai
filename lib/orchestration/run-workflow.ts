import type { AppDbClient } from "@/lib/db/types";
import {
  type WorkflowDefinition,
  type WorkflowNode,
  parseWorkflowDefinition,
  resolveLinearExecutionOrder,
  PLACEHOLDER_KEYS,
} from "@/lib/orchestration/workflow-definition";
import * as workflows from "@/lib/orchestration/workflows";

export type WorkflowRunContext = {
  conversationId?: string | null;
  callId?: string | null;
  cardId?: string | null;
  customerId?: string | null;
  tenantId: string;
  /** Resolved channel for complaints (e.g. from conversation row) */
  channel?: string | null;
};

const allowedPlaceholderSet = new Set<string>(PLACEHOLDER_KEYS);

function contextToFlat(ctx: WorkflowRunContext): Record<string, string> {
  const out: Record<string, string> = { tenantId: ctx.tenantId };
  if (ctx.cardId) out.cardId = ctx.cardId;
  if (ctx.customerId) out.customerId = ctx.customerId;
  if (ctx.conversationId) out.conversationId = ctx.conversationId;
  if (ctx.callId) out.callId = ctx.callId;
  return out;
}

const CHANNELS = ["web_chat", "app_chat", "voice", "agent_assist"] as const;

function narrowChannel(ch: string | null | undefined): (typeof CHANNELS)[number] {
  if (ch && (CHANNELS as readonly string[]).includes(ch)) {
    return ch as (typeof CHANNELS)[number];
  }
  return "web_chat";
}

/** Apply placeholders without URL-encoding (paths and JSON string values). */
function applyTemplateRaw(template: string, ctx: WorkflowRunContext): string {
  const flat = contextToFlat(ctx);
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!allowedPlaceholderSet.has(key)) {
      throw new Error(`Placeholder {${key}} is not allowlisted`);
    }
    const v = flat[key];
    if (v === undefined || v === "") {
      throw new Error(`Missing value for {${key}}`);
    }
    return v;
  });
}

function redactForLog(obj: Record<string, unknown>): Record<string, unknown> {
  const o = { ...obj };
  for (const k of Object.keys(o)) {
    if (/phone|email|token|secret|authorization/i.test(k)) {
      o[k] = "[redacted]";
    }
  }
  return o;
}

async function substituteJsonTemplates(
  value: unknown,
  ctx: WorkflowRunContext
): Promise<unknown> {
  if (typeof value === "string") {
    return applyTemplateRaw(value, ctx);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => substituteJsonTemplates(v, ctx)));
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([k, v]) => [k, await substituteJsonTemplates(v, ctx)] as const)
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function executeInternal(
  supabase: AppDbClient,
  node: Extract<WorkflowNode, { type: "internal" }>,
  ctx: WorkflowRunContext
): Promise<Record<string, unknown>> {
  const key = node.config.internal_key;
  const tenantId = ctx.tenantId;

  switch (key) {
    case "block_card": {
      if (!ctx.cardId) throw new Error("block_card requires cardId in context");
      await workflows.blockCardForCustomer(supabase, tenantId, ctx.cardId);
      return { ok: true, internal_key: key };
    }
    case "freeze_card": {
      if (!ctx.cardId) throw new Error("freeze_card requires cardId in context");
      await workflows.freezeCardForCustomer(supabase, tenantId, ctx.cardId);
      return { ok: true, internal_key: key };
    }
    case "create_complaint": {
      if (!ctx.customerId) throw new Error("create_complaint requires customerId in context");
      const category = node.config.category ?? "General";
      const summary =
        node.config.summary ??
        `Automated complaint from workflow (${node.name ?? node.id})`;
      const channel = narrowChannel(ctx.channel);
      const data = await workflows.createComplaintRecord({
        supabase,
        tenantId,
        customerId: ctx.customerId,
        channel,
        category,
        summary,
        conversationId: ctx.conversationId ?? undefined,
        callId: ctx.callId ?? undefined,
      });
      return { ok: true, complaintId: data.id, reference: data.reference };
    }
    case "append_live_event": {
      const eventType = node.config.event_type ?? "workflow.event";
      await workflows.appendLiveEvent(supabase, tenantId, eventType, {
        nodeId: node.id,
        conversationId: ctx.conversationId,
        callId: ctx.callId,
      });
      return { ok: true, event_type: eventType };
    }
    case "resolve_conversation": {
      if (!ctx.conversationId) throw new Error("resolve_conversation requires conversationId");
      await workflows.resolveConversation(
        supabase,
        tenantId,
        ctx.conversationId,
        node.config.containment ?? true
      );
      return { ok: true };
    }
    case "escalate_conversation": {
      if (!ctx.conversationId) throw new Error("escalate_conversation requires conversationId");
      await workflows.escalateConversation(supabase, tenantId, ctx.conversationId);
      return { ok: true };
    }
    default: {
      const _exhaustive: never = key;
      throw new Error(`Unknown internal key: ${_exhaustive}`);
    }
  }
}

async function executeHttpRequest(
  node: Extract<WorkflowNode, { type: "http_request" }>,
  ctx: WorkflowRunContext,
  adapterBaseUrl: string
): Promise<Record<string, unknown>> {
  const pathResolved = applyTemplateRaw(node.config.path_template, ctx);
  const url = `${adapterBaseUrl.replace(/\/$/, "")}${pathResolved.startsWith("/") ? pathResolved : `/${pathResolved}`}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const apiKey = process.env.BANK_ADAPTER_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const method = node.config.method;
  const body =
    method !== "GET" && node.config.body_template
      ? JSON.stringify(await substituteJsonTemplates(node.config.body_template, ctx))
      : undefined;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal });
    const text = await res.text();
    let json: unknown = { raw: text.slice(0, 2000) };
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      /* keep raw wrapper */
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return { ok: true, status: res.status, body: json };
  } finally {
    clearTimeout(t);
  }
}

function noopExecute(node: Extract<WorkflowNode, { type: "noop" }>) {
  return { ok: true, noop: node.id };
}

export type RunWorkflowResult = {
  runId: string;
  status: "success" | "failed";
  errorMessage?: string;
};

export function resolveAdapterBaseUrl(): string {
  const explicit = process.env.BANK_ADAPTER_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const app =
    process.env.INTERNAL_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (app) return `${app.replace(/\/$/, "")}/api/mock-adapter`;
  return "http://127.0.0.1:3001/api/mock-adapter";
}

export async function runWorkflowEngine(input: {
  supabase: AppDbClient;
  userId: string;
  tenantId: string;
  workflowId: string;
  definitionRaw: unknown;
  context: Omit<WorkflowRunContext, "tenantId">;
}): Promise<RunWorkflowResult> {
  const { supabase, userId, tenantId, workflowId } = input;
  let definition: WorkflowDefinition;
  try {
    definition = parseWorkflowDefinition(input.definitionRaw);
  } catch (e) {
    return {
      runId: "",
      status: "failed",
      errorMessage: e instanceof Error ? e.message : "Invalid workflow definition",
    };
  }

  let ordered: WorkflowNode[];
  try {
    ordered = resolveLinearExecutionOrder(definition);
  } catch (e) {
    return {
      runId: "",
      status: "failed",
      errorMessage: e instanceof Error ? e.message : "Invalid graph",
    };
  }

  const ctx: WorkflowRunContext = { ...input.context, tenantId };
  const adapterBase = resolveAdapterBaseUrl();

  const { data: runRow, error: runErr } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_id: workflowId,
      tenant_id: tenantId,
      triggered_by: userId,
      status: "running",
      context: redactForLog({
        ...input.context,
        tenantId,
      }) as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return {
      runId: "",
      status: "failed",
      errorMessage: runErr?.message ?? "Could not create run",
    };
  }

  const runId = runRow.id as string;

  await workflows.appendLiveEvent(supabase, tenantId, "workflow.started", {
    workflowId,
    runId,
  });

  try {
    for (const node of ordered) {
      const inputLog = redactForLog({ context: ctx }) as Record<string, unknown>;
      let output: Record<string, unknown>;
      if (node.type === "internal") {
        output = await executeInternal(supabase, node, ctx);
      } else if (node.type === "http_request") {
        output = await executeHttpRequest(node, ctx, adapterBase);
      } else if (node.type === "noop") {
        output = noopExecute(node);
      } else {
        throw new Error(`Unsupported node type: ${(node as WorkflowNode).type}`);
      }

      await supabase.from("workflow_run_steps").insert({
        run_id: runId,
        node_id: node.id,
        node_type: node.type,
        status: "success",
        input_redacted: inputLog,
        output_redacted: redactForLog(output) as Record<string, unknown>,
      });
    }

    await supabase
      .from("workflow_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await workflows.appendLiveEvent(supabase, tenantId, "workflow.completed", {
      workflowId,
      runId,
    });

    return { runId, status: "success" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Workflow failed";
    await supabase.from("workflow_run_steps").insert({
      run_id: runId,
      node_id: "_error",
      node_type: "error",
      status: "failed",
      output_redacted: { error: msg },
    });
    await supabase
      .from("workflow_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq("id", runId);

    await workflows.appendLiveEvent(supabase, tenantId, "workflow.failed", {
      workflowId,
      runId,
      error: msg,
    });

    return { runId, status: "failed", errorMessage: msg };
  }
}
