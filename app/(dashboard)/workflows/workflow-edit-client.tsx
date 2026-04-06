"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReactFlowProvider } from "@xyflow/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  type WorkflowNode,
  type WorkflowDefinition,
  INTERNAL_KEYS,
  parseWorkflowDefinition,
  resolveLinearExecutionOrder,
  defaultWorkflowDefinition,
} from "@/lib/orchestration/workflow-definition";
import {
  WorkflowCanvasEditor,
  appendStepToDefinition,
} from "@/components/workflow-editor/workflow-canvas-editor";
import { updateWorkflowAction, deleteWorkflowAction } from "./actions";

const CHANNEL_OPTIONS = [
  { value: "web_chat", label: "Web chat" },
  { value: "app_chat", label: "App chat" },
  { value: "voice", label: "Voice" },
  { value: "agent_assist", label: "Agent assist" },
] as const;

function newStepId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `step_${crypto.randomUUID().slice(0, 8)}`;
  return `step_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultStep(type: WorkflowNode["type"]): WorkflowNode {
  const id = newStepId();
  if (type === "internal") {
    return {
      id,
      type: "internal",
      name: "Internal step",
      config: { internal_key: "append_live_event", event_type: "workflow.step" },
    };
  }
  if (type === "http_request") {
    return {
      id,
      type: "http_request",
      name: "HTTP call",
      config: {
        method: "GET",
        path_template: "/v1/ping",
      },
    };
  }
  return { id, type: "noop", name: "No-op" };
}

type RunRow = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
};

type StepLog = {
  id: string;
  node_id: string;
  node_type: string;
  status: string;
  created_at: string;
};

export function WorkflowEditClient({
  workflow,
  runs,
  runStepsByRunId,
  isAdmin,
}: {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    trigger_type: string;
    trigger_config: Record<string, unknown> | null;
    channels: string[] | null;
    definition: unknown;
    sort_order: number;
    category: string | null;
  };
  runs: RunRow[];
  runStepsByRunId: Record<string, StepLog[]>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  let initialDef: WorkflowDefinition;
  try {
    initialDef = parseWorkflowDefinition(workflow.definition);
  } catch {
    initialDef = defaultWorkflowDefinition();
  }
  const [name, setName] = React.useState(workflow.name);
  const [category, setCategory] = React.useState(workflow.category ?? "");
  const [description, setDescription] = React.useState(workflow.description ?? "");
  const [enabled, setEnabled] = React.useState(workflow.enabled);
  const [triggerType, setTriggerType] = React.useState(workflow.trigger_type);
  const [intentMatch, setIntentMatch] = React.useState(
    String((workflow.trigger_config as { intent?: string } | null)?.intent ?? "")
  );
  const [channels, setChannels] = React.useState<string[]>(
    workflow.channels?.length ? workflow.channels : ["web_chat", "app_chat", "voice", "agent_assist"]
  );
  const [definition, setDefinition] = React.useState<WorkflowDefinition>(initialDef);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [jsonText, setJsonText] = React.useState(() => JSON.stringify(initialDef, null, 2));
  const [saving, setSaving] = React.useState(false);
  const [expandedRun, setExpandedRun] = React.useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  function refreshJsonFromDefinition() {
    setJsonText(JSON.stringify(definition, null, 2));
  }

  const selectedNode = selectedNodeId
    ? (definition.nodes.find((n) => n.id === selectedNodeId) ?? null)
    : null;

  function updateNodeInDefinition(id: string, node: WorkflowNode) {
    setDefinition((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? node : n)),
    }));
  }

  async function save(partial?: Partial<{ definition: WorkflowDefinition }>) {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const def = partial?.definition ?? definition;
      parseWorkflowDefinition(def);
      resolveLinearExecutionOrder(def);
      await updateWorkflowAction(workflow.id, {
        name,
        category: category.trim() || null,
        description: description || null,
        enabled,
        trigger_type: triggerType as "manual" | "intent_match",
        trigger_config:
          triggerType === "intent_match" ? { intent: intentMatch.trim() || "general" } : {},
        channels,
        definition: def,
        sort_order: workflow.sort_order,
      });
      toast.success("Saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function applyJson() {
    if (!isAdmin) return;
    try {
      const parsed = parseWorkflowDefinition(JSON.parse(jsonText));
      resolveLinearExecutionOrder(parsed);
      setDefinition(parsed);
      setSelectedNodeId(null);
      toast.success("JSON applied to canvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  async function confirmDeleteWorkflow() {
    setDeleting(true);
    try {
      await deleteWorkflowAction(workflow.id);
      toast.success("Deleted");
      setDeleteDialogOpen(false);
      router.push("/workflows");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(next) => {
          if (deleting && !next) return;
          setDeleteDialogOpen(next);
        }}
      >
        <DialogContent showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>Delete workflow?</DialogTitle>
            <DialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{name || "this workflow"}</span>
              . Run history for this workflow will remain unless cleaned up separately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDeleteWorkflow()}>
              {deleting ? "Deleting…" : "Delete workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/workflows" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← All workflows
        </Link>
        {isAdmin && (
          <div className="flex gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
              Delete
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={() => save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Name</p>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input
                id="wf-enabled"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!isAdmin}
                className="h-4 w-4 rounded border-border"
              />
              <label htmlFor="wf-enabled" className="text-sm font-medium">
                Enabled (operators can run manual workflows)
              </label>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Description</p>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Catalog category</p>
            <Input
              placeholder="e.g. IT support, HR operations, Compliance"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Trigger</p>
            <select
              className="h-10 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              disabled={!isAdmin}
            >
              <option value="manual">Manual (operator runs from Conversations / Voice)</option>
              <option value="intent_match">Intent match (suggested when intent matches)</option>
            </select>
            {triggerType === "intent_match" && (
              <div className="mt-2">
                <p className="mb-1 text-xs text-muted-foreground">Intent string to match</p>
                <Input
                  placeholder="e.g. Raast issue"
                  value={intentMatch}
                  onChange={(e) => setIntentMatch(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Channels</p>
            <div className="flex flex-wrap gap-3">
              {CHANNEL_OPTIONS.map((ch) => (
                <label key={ch.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={channels.includes(ch.value)}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      if (e.target.checked) setChannels([...channels, ch.value]);
                      else setChannels(channels.filter((c) => c !== ch.value));
                    }}
                  />
                  {ch.label}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs
        defaultValue="canvas"
        onValueChange={(v) => {
          if (v === "json") refreshJsonFromDefinition();
        }}
      >
        <TabsList>
          <TabsTrigger value="canvas">Canvas</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="canvas" className="mt-4 space-y-4">
          {!isAdmin && (
            <p className="text-sm text-muted-foreground">Only admins can edit the workflow graph.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Pan and zoom the canvas. Drag <strong>nodes</strong> to arrange. Draw connections from the right handle of one
            node to the left handle of the next. The run order must stay a <strong>single chain</strong> from Start through
            every step. Use Backspace/Delete to remove a selected node or edge.
          </p>
          <div className="grid gap-4 xl:grid-cols-[1fr_minmax(280px,320px)]">
            <div className="space-y-3">
              <ReactFlowProvider>
                <WorkflowCanvasEditor
                  definition={definition}
                  onChange={setDefinition}
                  readOnly={!isAdmin}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                />
              </ReactFlowProvider>
              {isAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setDefinition((d) => appendStepToDefinition(d, defaultStep("internal")))}
                  >
                    + Internal
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setDefinition((d) => appendStepToDefinition(d, defaultStep("http_request")))}
                  >
                    + HTTP
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDefinition((d) => appendStepToDefinition(d, defaultStep("noop")))}
                  >
                    + No-op
                  </Button>
                </div>
              )}
            </div>
            <Card className="h-fit border-border bg-card xl:sticky xl:top-4">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Node details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {!selectedNode && (
                  <p className="text-xs text-muted-foreground">Select a node on the canvas to edit its label and settings.</p>
                )}
                {selectedNode?.type === "trigger_manual" && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Start node — connect its output to the first step.</p>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">Label</p>
                      <Input
                        value={selectedNode.name ?? ""}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          updateNodeInDefinition(selectedNode.id, {
                            ...selectedNode,
                            name: e.target.value,
                          } as WorkflowNode)
                        }
                      />
                    </div>
                  </div>
                )}
                {selectedNode && selectedNode.type === "internal" && (
                  <div className="space-y-3">
                    <div className="grid gap-2">
                      <p className="text-xs font-semibold text-muted-foreground">Label</p>
                      <Input
                        value={selectedNode.name ?? ""}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          updateNodeInDefinition(selectedNode.id, {
                            ...selectedNode,
                            name: e.target.value,
                          } as WorkflowNode)
                        }
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">Action</p>
                      <select
                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                        value={selectedNode.config.internal_key}
                        disabled={!isAdmin}
                        onChange={(e) => {
                          const k = e.target.value as (typeof INTERNAL_KEYS)[number];
                          const base = { internal_key: k };
                          updateNodeInDefinition(selectedNode.id, {
                            ...selectedNode,
                            config:
                              k === "create_complaint"
                                ? { ...base, category: "General" }
                                : k === "append_live_event"
                                  ? { ...base, event_type: "workflow.step" }
                                  : k === "resolve_conversation"
                                    ? { ...base, containment: true }
                                    : base,
                          } as WorkflowNode);
                        }}
                      >
                        {INTERNAL_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedNode.config.internal_key === "create_complaint" && (
                      <>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-muted-foreground">Category</p>
                          <Input
                            value={selectedNode.config.category ?? ""}
                            disabled={!isAdmin}
                            onChange={(e) =>
                              updateNodeInDefinition(selectedNode.id, {
                                ...selectedNode,
                                config: { ...selectedNode.config, category: e.target.value },
                              } as WorkflowNode)
                            }
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-muted-foreground">Summary</p>
                          <Input
                            value={selectedNode.config.summary ?? ""}
                            disabled={!isAdmin}
                            placeholder="Optional complaint summary"
                            onChange={(e) =>
                              updateNodeInDefinition(selectedNode.id, {
                                ...selectedNode,
                                config: { ...selectedNode.config, summary: e.target.value },
                              } as WorkflowNode)
                            }
                          />
                        </div>
                      </>
                    )}
                    {selectedNode.config.internal_key === "append_live_event" && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-muted-foreground">Event type</p>
                        <Input
                          value={selectedNode.config.event_type ?? ""}
                          disabled={!isAdmin}
                          onChange={(e) =>
                            updateNodeInDefinition(selectedNode.id, {
                              ...selectedNode,
                              config: { ...selectedNode.config, event_type: e.target.value },
                            } as WorkflowNode)
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
                {selectedNode && selectedNode.type === "http_request" && (
                  <div className="space-y-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">Label</p>
                      <Input
                        value={selectedNode.name ?? ""}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          updateNodeInDefinition(selectedNode.id, {
                            ...selectedNode,
                            name: e.target.value,
                          } as WorkflowNode)
                        }
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">Method</p>
                      <select
                        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                        value={selectedNode.config.method}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          updateNodeInDefinition(selectedNode.id, {
                            ...selectedNode,
                            config: {
                              ...selectedNode.config,
                              method: e.target.value as "GET" | "POST" | "PUT" | "PATCH",
                            },
                          } as WorkflowNode)
                        }
                      >
                        {(["GET", "POST", "PUT", "PATCH"] as const).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">
                        Path (placeholders: {"{cardId}"}, {"{customerId}"}, …)
                      </p>
                      <Input
                        className="font-mono text-xs"
                        value={selectedNode.config.path_template}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          updateNodeInDefinition(selectedNode.id, {
                            ...selectedNode,
                            config: { ...selectedNode.config, path_template: e.target.value },
                          } as WorkflowNode)
                        }
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">Body JSON (optional)</p>
                      <textarea
                        className={cn(
                          "flex min-h-[96px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                        )}
                        rows={4}
                        disabled={!isAdmin}
                        value={
                          selectedNode.config.body_template
                            ? JSON.stringify(selectedNode.config.body_template, null, 2)
                            : ""
                        }
                        placeholder='{"customerId":"{customerId}"}'
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!raw) {
                            updateNodeInDefinition(selectedNode.id, {
                              ...selectedNode,
                              config: { ...selectedNode.config, body_template: undefined },
                            } as WorkflowNode);
                            return;
                          }
                          try {
                            const parsed = JSON.parse(raw) as Record<string, unknown>;
                            updateNodeInDefinition(selectedNode.id, {
                              ...selectedNode,
                              config: { ...selectedNode.config, body_template: parsed },
                            } as WorkflowNode);
                          } catch {
                            /* keep typing */
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
                {selectedNode?.type === "noop" && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">Label</p>
                    <Input
                      value={selectedNode.name ?? ""}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        updateNodeInDefinition(selectedNode.id, {
                          ...selectedNode,
                          name: e.target.value,
                        } as WorkflowNode)
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="json" className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Full graph (must stay a single linear chain from trigger_manual).
          </p>
          <textarea
            className={cn(
              "min-h-[320px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            )}
            value={jsonText}
            disabled={!isAdmin}
            onChange={(e) => setJsonText(e.target.value)}
          />
          {isAdmin && (
            <Button type="button" className="mt-2" size="sm" variant="secondary" onClick={applyJson}>
              Parse JSON into steps
            </Button>
          )}
        </TabsContent>
      </Tabs>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Run history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            runs.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  onClick={() => setExpandedRun((x) => (x === r.id ? null : r.id))}
                >
                  <span className="font-mono text-xs">{r.id.slice(0, 8)}…</span>
                  <Badge variant={r.status === "success" ? "default" : "destructive"}>{r.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.started_at).toLocaleString()}
                  </span>
                </button>
                {r.error_message && (
                  <p className="mt-2 text-xs text-destructive">{r.error_message}</p>
                )}
                {expandedRun === r.id && (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                    {(runStepsByRunId[r.id] ?? []).map((s) => (
                      <li key={s.id}>
                        <span className="font-mono">{s.node_id}</span> ({s.node_type}) — {s.status}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
