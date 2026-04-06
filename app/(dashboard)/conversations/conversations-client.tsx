"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  blockCardAction,
  createComplaintFromConversationAction,
  escalateConversationAction,
  generateSummaryAction,
  resolveConversationAction,
  setConversationAgentAction,
} from "./actions";
import { runPublishedWorkflowAction } from "../workflows/run-workflow-action";
import {
  CHAT_LANGUAGE_OPTIONS,
  type ChatLanguage,
} from "@/lib/ai/chat-languages";
import { playOpenAiTts } from "@/lib/play-openai-tts";

type ConversationReplyStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reply: string; messageId: string }
  | { type: "error"; status: number; error: string };

async function consumeConversationReplySse(
  res: Response,
  handlers: {
    onDelta: (text: string) => void;
    onDone: (payload: { reply: string; messageId: string }) => void;
    onError: (payload: { status: number; error: string }) => void;
  }
) {
  const reader = res.body?.getReader();
  if (!reader) {
    handlers.onError({ status: 500, error: "No response body" });
    return;
  }
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (;;) {
      const sep = buf.indexOf("\n\n");
      if (sep < 0) break;
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let evt: ConversationReplyStreamEvent;
        try {
          evt = JSON.parse(line.slice(6)) as ConversationReplyStreamEvent;
        } catch {
          continue;
        }
        if (evt.type === "delta") handlers.onDelta(evt.text);
        else if (evt.type === "done") handlers.onDone({ reply: evt.reply, messageId: evt.messageId });
        else if (evt.type === "error") handlers.onError({ status: evt.status, error: evt.error });
      }
    }
  }
}

type Row = {
  id: string;
  channel: string;
  status: string;
  intent: string | null;
  summary: string | null;
  last_message_at: string;
  agent_id: string | null;
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    account_number: string | null;
    risk_level: string | null;
  } | null;
  messages: { id: string; sender: string; body: string; created_at: string }[];
};

type CardRow = { id: string; customer_id: string; last_four: string; status: string };

type ManualWf = { id: string; name: string; channels: string[] };
type IntentWf = { id: string; name: string; intent: string; channels: string[] };
type ChatAgentOpt = { id: string; name: string; kind: string };

type AgentInsight = {
  name: string;
  citationsRequired: boolean;
  escalationTeam: string | null;
  handoffEnabled: boolean;
};

export function ConversationsClient({
  romanUrduSupport,
  openAiConfigured,
  aiAutoReplyEnabled,
  aiSummariesEnabled,
  aiTtsEnabled,
  initial,
  cards,
  manualWorkflows,
  intentWorkflows,
  chatAgents,
  agentInsights = {},
}: {
  romanUrduSupport: boolean;
  openAiConfigured: boolean;
  aiAutoReplyEnabled: boolean;
  aiSummariesEnabled: boolean;
  aiTtsEnabled: boolean;
  initial: Row[];
  cards: CardRow[];
  manualWorkflows: ManualWf[];
  intentWorkflows: IntentWf[];
  chatAgents: ChatAgentOpt[];
  agentInsights?: Record<string, AgentInsight>;
}) {
  const [rows, setRows] = React.useState(initial);
  const [selectedId, setSelectedId] = React.useState<string | null>(initial[0]?.id ?? null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [replyLanguage, setReplyLanguage] = React.useState<ChatLanguage>("ur");
  const [speakAiReplies, setSpeakAiReplies] = React.useState(false);

  React.useEffect(() => {
    setRows(initial);
  }, [initial]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const customerCards = selected
    ? cards.filter((c) => c.customer_id === selected.customer?.id)
    : [];

  const agentSelectOptions = React.useMemo(() => {
    const list = [...chatAgents];
    const cur = selected?.agent_id;
    if (cur && !list.some((a) => a.id === cur)) {
      const label = agentInsights[cur]?.name ?? cur.slice(0, 8);
      list.unshift({ id: cur, name: `${label} (current)`, kind: "assigned" });
    }
    return list;
  }, [chatAgents, selected?.agent_id, agentInsights]);

  const runnableWorkflows = React.useMemo(() => {
    if (!selected) return [];
    return manualWorkflows.filter((w) => w.channels.includes(selected.channel));
  }, [manualWorkflows, selected]);

  const canUseAiReply = openAiConfigured && aiAutoReplyEnabled;
  const canUseAiSummaries = openAiConfigured && aiSummariesEnabled;
  const canUseTts = openAiConfigured && aiTtsEnabled;

  const intentSuggestions = React.useMemo(() => {
    if (!selected?.intent?.trim()) return [];
    const t = selected.intent.trim().toLowerCase();
    return intentWorkflows.filter(
      (w) =>
        w.intent.trim().toLowerCase() === t && w.channels.includes(selected.channel)
    );
  }, [intentWorkflows, selected]);

  async function onRunWorkflow(workflowId: string) {
    if (!selected) return;
    const cardId = customerCards[0]?.id;
    setBusy("wf");
    try {
      const r = await runPublishedWorkflowAction(workflowId, {
        conversationId: selected.id,
        cardId,
        customerId: selected.customer?.id,
      });
      if (r.status === "failed") {
        toast.error(r.errorMessage ?? "Workflow failed");
      } else {
        toast.success("Workflow completed");
        window.location.reload();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Workflow failed");
    } finally {
      setBusy(null);
    }
  }

  async function onClassify() {
    if (!selected) return;
    setBusy("classify");
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: selected.customer?.full_name,
          recentMessages: selected.messages.slice(-8).map((m) => ({
            role: m.sender === "customer" ? "customer" : m.sender,
            content: m.body,
          })),
          romanUrdu: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Intent: ${data.intent}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Classify failed");
    } finally {
      setBusy(null);
    }
  }

  async function onAgentChange(agentId: string) {
    if (!selected) return;
    setBusy("agent");
    try {
      await setConversationAgentAction(selected.id, agentId === "" ? null : agentId);
      setRows((prev) =>
        prev.map((r) =>
          r.id === selected.id ? { ...r, agent_id: agentId === "" ? null : agentId } : r
        )
      );
      toast.success("Agent assignment saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign agent");
    } finally {
      setBusy(null);
    }
  }

  async function onAiReply() {
    if (!selected) return;
    const conversationId = selected.id;
    const pendingId = `ai-stream-${Date.now()}`;
    const nowIso = new Date().toISOString();
    setBusy("ai");
    setRows((prev) =>
      prev.map((r) =>
        r.id === conversationId
          ? {
              ...r,
              messages: [
                ...r.messages,
                { id: pendingId, sender: "ai", body: "", created_at: nowIso },
              ],
            }
          : r
      )
    );
    let finalReply = "";
    try {
      const res = await fetch("/api/ai/conversation-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          language: replyLanguage,
          stream: true,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Request failed");
      }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/event-stream")) {
        const data = (await res.json()) as { reply?: string; error?: string; messageId?: string };
        if (data.error) throw new Error(data.error);
        finalReply = data.reply ?? "";
        setRows((prev) =>
          prev.map((r) =>
            r.id === conversationId
              ? {
                  ...r,
                  last_message_at: nowIso,
                  messages: r.messages.map((m) =>
                    m.id === pendingId
                      ? {
                          ...m,
                          id: data.messageId ?? pendingId,
                          body: finalReply,
                        }
                      : m
                  ),
                }
              : r
          )
        );
      } else {
        await consumeConversationReplySse(res, {
          onDelta: (text) => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === conversationId
                  ? {
                      ...r,
                      messages: r.messages.map((m) =>
                        m.id === pendingId ? { ...m, body: m.body + text } : m
                      ),
                    }
                  : r
              )
            );
          },
          onDone: ({ reply, messageId }) => {
            finalReply = reply;
            setRows((prev) =>
              prev.map((r) =>
                r.id === conversationId
                  ? {
                      ...r,
                      last_message_at: new Date().toISOString(),
                      messages: r.messages.map((m) =>
                        m.id === pendingId ? { ...m, id: messageId, body: reply } : m
                      ),
                    }
                  : r
              )
            );
          },
          onError: ({ error }) => {
            throw new Error(error);
          },
        });
      }

      if (speakAiReplies && canUseTts && finalReply) {
        try {
          await playOpenAiTts(finalReply, {
            language: replyLanguage,
            romanUrdu: replyLanguage === "ur" && romanUrduSupport,
          });
        } catch (ttsErr) {
          toast.error(ttsErr instanceof Error ? ttsErr.message : "Voice playback failed");
        }
      }
      toast.success("AI reply added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
      setRows((prev) =>
        prev.map((r) =>
          r.id === conversationId
            ? { ...r, messages: r.messages.filter((m) => m.id !== pendingId) }
            : r
        )
      );
    } finally {
      setBusy(null);
    }
  }

  async function onBlockCard() {
    if (!selected || !customerCards[0]) {
      toast.error("No card on file for this customer");
      return;
    }
    setBusy("block");
    try {
      await blockCardAction(selected.id, customerCards[0].id);
      toast.success("Card blocked; complaint created");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Block failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid h-[calc(100vh-8rem)] gap-4 lg:grid-cols-[320px_1fr_340px]">
      <Card className="flex flex-col overflow-hidden border-border bg-card p-0">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Inbox
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "w-full rounded-xl border border-transparent px-3 py-3 text-left text-sm transition-colors",
                  selectedId === r.id
                    ? "border-primary/20 bg-primary/10"
                    : "hover:bg-secondary/50"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {r.customer?.full_name?.trim() || "Unknown"}
                  </span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {r.channel.replace("_", " ")}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.summary}</p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      <Card className="flex flex-col overflow-hidden border-border bg-card py-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" htmlFor="conv-reply-lang">
            Reply language
          </label>
          <select
            id="conv-reply-lang"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={replyLanguage}
            onChange={(e) => setReplyLanguage(e.target.value as ChatLanguage)}
            disabled={busy !== null}
          >
            {CHAT_LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
            title={
              !canUseTts
                ? !openAiConfigured
                  ? "Configure OPENAI_API_KEY"
                  : "Enable TTS in Settings → AI automation"
                : undefined
            }
          >
            <input
              type="checkbox"
              checked={speakAiReplies}
              onChange={(e) => setSpeakAiReplies(e.target.checked)}
              disabled={busy !== null || !canUseTts}
            />
            Read reply aloud
          </label>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="conv-chat-agent">
              Governed agent
            </label>
            <select
              id="conv-chat-agent"
              className="h-8 max-w-[11rem] rounded-md border border-input bg-background px-2 text-xs"
              value={selected?.agent_id ?? ""}
              onChange={(e) => void onAgentChange(e.target.value)}
              disabled={!selected || busy !== null}
            >
              <option value="">Platform default</option>
              {agentSelectOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.kind && a.kind !== "assigned" ? ` (${a.kind})` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!selected || busy !== null || !canUseAiReply}
            title={
              !openAiConfigured
                ? "Configure OPENAI_API_KEY on the server"
                : !aiAutoReplyEnabled
                  ? "Enable AI replies in Settings → AI automation"
                  : undefined
            }
            onClick={onClassify}
          >
            Detect intent
          </Button>
          <Button
            size="sm"
            disabled={!selected || busy !== null || !canUseAiReply}
            title={
              !openAiConfigured
                ? "Configure OPENAI_API_KEY on the server"
                : !aiAutoReplyEnabled
                  ? "Enable AI replies in Settings → AI automation"
                  : undefined
            }
            onClick={onAiReply}
          >
            {busy === "ai" ? "Generating…" : "Generate AI reply"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!selected || runnableWorkflows.length === 0 || busy !== null}
              render={
                <Button size="sm" variant="secondary">
                  Run workflow
                </Button>
              }
            />
            <DropdownMenuContent>
              {runnableWorkflows.map((w) => (
                <DropdownMenuItem key={w.id} onClick={() => onRunWorkflow(w.id)}>
                  {w.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {intentSuggestions.map((w) => (
            <Button
              key={w.id}
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => onRunWorkflow(w.id)}
            >
              Suggested: {w.name}
            </Button>
          ))}
          <Button size="sm" variant="outline" disabled={!selected || busy !== null} onClick={onBlockCard}>
            Block card
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!selected || busy !== null}
            onClick={async () => {
              if (!selected) return;
              setBusy("cmp");
              try {
                await createComplaintFromConversationAction(selected.id, "General");
                toast.success("Complaint created");
                window.location.reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            Create complaint
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!selected || busy !== null}
            onClick={async () => {
              if (!selected) return;
              setBusy("esc");
              try {
                await escalateConversationAction(selected.id);
                toast.success("Escalated");
                window.location.reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            Escalate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!selected || busy !== null}
            onClick={async () => {
              if (!selected) return;
              setBusy("res");
              try {
                await resolveConversationAction(selected.id, true);
                toast.success("Resolved (contained)");
                window.location.reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            Mark resolved
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!selected || busy !== null || !canUseAiSummaries}
            title={
              !openAiConfigured
                ? "Configure OPENAI_API_KEY on the server"
                : !aiSummariesEnabled
                  ? "Enable AI summaries in Settings → AI automation"
                  : undefined
            }
            onClick={async () => {
              if (!selected) return;
              setBusy("sum");
              try {
                const r = await generateSummaryAction(selected.id);
                toast.success("Summary saved");
                navigator.clipboard.writeText(r.summary);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            Generate summary
          </Button>
        </div>
        <ScrollArea className="flex-1 p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a conversation.</p>
          ) : (
            <div className="space-y-4">
              {selected.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-2xl border border-border px-4 py-3 text-sm",
                    m.sender === "customer"
                      ? "ml-0 mr-auto bg-secondary/40"
                      : "ml-auto mr-0 bg-primary/10"
                  )}
                >
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">{m.sender}</p>
                  <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="space-y-0 p-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Context</h3>
        {selected?.customer ? (
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Contact</p>
              <p className="font-semibold">{selected.customer.full_name?.trim() || "Unknown"}</p>
              <p className="text-xs text-muted-foreground">{selected.customer.email}</p>
              <p className="font-mono text-xs">{selected.customer.account_number}</p>
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground">Detected intent</p>
              <p className="font-mono text-sm">{selected.intent ?? "—"}</p>
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground">Assigned governed agent</p>
              <p className="text-sm">
                {selected.agent_id
                  ? chatAgents.find((a) => a.id === selected.agent_id)?.name ??
                    agentInsights[selected.agent_id]?.name ??
                    selected.agent_id.slice(0, 8) + "…"
                  : "Platform default (no named agent)"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Use the governed agent dropdown above to change routing for this thread.
              </p>
              {selected.agent_id && agentInsights[selected.agent_id] ? (
                <div className="mt-3 rounded-lg border border-border/60 bg-secondary/20 p-3 text-xs">
                  <p className="font-bold uppercase tracking-wider text-muted-foreground">Governance</p>
                  <p className="mt-2 text-muted-foreground">
                    Citations:{" "}
                    <span className="font-medium text-foreground">
                      {agentInsights[selected.agent_id].citationsRequired ? "Required" : "Optional"}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Handoff:{" "}
                    <span className="font-medium text-foreground">
                      {agentInsights[selected.agent_id].handoffEnabled ? "Enabled" : "Disabled"}
                    </span>
                    {agentInsights[selected.agent_id].escalationTeam
                      ? ` → ${agentInsights[selected.agent_id].escalationTeam}`
                      : ""}
                  </p>
                </div>
              ) : null}
            </div>
            <Separator />
            {selected.agent_id && agentInsights[selected.agent_id]?.citationsRequired ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">Retrieval &amp; citations (preview)</p>
                  <p className="mt-2 rounded-md border border-dashed border-primary/25 bg-primary/5 p-2 text-[11px] leading-relaxed text-muted-foreground">
                    Policy-grounded answers would list matched knowledge chunks with confidence scores and document IDs
                    for audit. Demo UI — wire to live RAG metadata from your retrieval pipeline.
                  </p>
                </div>
                <Separator />
              </>
            ) : null}
            <div>
              <p className="text-xs text-muted-foreground">Cards</p>
              {customerCards.length === 0 ? (
                <p className="text-xs">No cards</p>
              ) : (
                customerCards.map((c) => (
                  <p key={c.id} className="font-mono text-xs">
                    •••• {c.last_four} — {c.status}
                  </p>
                ))
              )}
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground">Orchestration suggestions</p>
              <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                {selected.intent?.toLowerCase().includes("leave") ||
                selected.intent?.toLowerCase().includes("hr") ||
                selected.intent?.toLowerCase().includes("payroll") ? (
                  <>
                    <li>Confirm policy citations from HR knowledge base</li>
                    <li>Offer HR queue handoff with conversation summary</li>
                  </>
                ) : selected.intent?.toLowerCase().includes("vpn") ||
                  selected.intent?.toLowerCase().includes("password") ||
                  selected.intent?.toLowerCase().includes("email") ? (
                  <>
                    <li>Run IT ticket / password reset workflow if allowlisted</li>
                    <li>Capture device + error codes for service desk</li>
                  </>
                ) : (
                  <>
                    <li>Match channel intent to manual or intent-triggered workflows</li>
                    <li>Offer card controls or complaint when risk signals appear</li>
                    <li>Generate structured handoff note before escalation</li>
                  </>
                )}
              </ul>
              {intentSuggestions.length > 0 ? (
                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-primary">
                  Intent-matched workflow{intentSuggestions.length > 1 ? "s" : ""} available — use Run workflow
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No customer linked.</p>
        )}
        </CardContent>
      </Card>
    </div>
  );
}
