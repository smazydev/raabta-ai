"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, PanelRight, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownArtifact } from "@/components/assistant/markdown-artifact";
import { cn, randomId } from "@/lib/utils";
import { formatYmdHm } from "@/lib/format-date";

type Line = { id: string; role: "user" | "assistant"; content: string; artifact?: string | null };

type SessionSummary = { id: string; title: string | null; updated_at: string; ai_agent_id: string | null };

type AgentOption = { id: string; name: string; status: string; kind: string };

type StreamEvent =
  | { type: "meta"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "status"; message: string }
  | { type: "done"; sessionId: string; reply: string; artifactMarkdown: string | null }
  | { type: "error"; status: number; error: string };

async function consumeAssistantSse(
  res: Response,
  handlers: {
    onMeta: (sessionId: string) => void;
    onDelta: (text: string) => void;
    onStatus: (message: string) => void;
    onDone: (payload: { sessionId: string; reply: string; artifactMarkdown: string | null }) => void;
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
        let evt: StreamEvent;
        try {
          evt = JSON.parse(line.slice(6)) as StreamEvent;
        } catch {
          continue;
        }
        if (evt.type === "meta") handlers.onMeta(evt.sessionId);
        else if (evt.type === "delta") handlers.onDelta(evt.text);
        else if (evt.type === "status") handlers.onStatus(evt.message);
        else if (evt.type === "done")
          handlers.onDone({
            sessionId: evt.sessionId,
            reply: evt.reply,
            artifactMarkdown: evt.artifactMarkdown,
          });
        else if (evt.type === "error") handlers.onError({ status: evt.status, error: evt.error });
      }
    }
  }
}

export function AssistantClient({
  openAiConfigured,
  assistantCopilotEnabled,
  sessions,
  agents,
  initialSessionId,
  initialAiAgentId,
  initialLines,
  initialArtifact,
  forceNewChat,
}: {
  openAiConfigured: boolean;
  assistantCopilotEnabled: boolean;
  sessions: SessionSummary[];
  agents: AgentOption[];
  initialSessionId: string | null;
  initialAiAgentId: string | null;
  initialLines: Line[];
  initialArtifact: string | null;
  forceNewChat: boolean;
}) {
  const router = useRouter();
  const canChat = openAiConfigured && assistantCopilotEnabled;
  const [lines, setLines] = React.useState<Line[]>(initialLines);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<string | null>(initialSessionId);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(initialAiAgentId);
  const [artifact, setArtifact] = React.useState<string | null>(initialArtifact);
  const [streamHint, setStreamHint] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setSelectedAgentId(initialAiAgentId);
  }, [initialAiAgentId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, busy]);

  async function send() {
    const text = draft.trim();
    if (!text || busy || !canChat) return;
    setDraft("");
    setBusy(true);
    const assistantId = randomId();
    const hadNoSession = sessionId == null;
    setLines((prev) => [
      ...prev,
      { id: randomId(), role: "user", content: text },
      { id: assistantId, role: "assistant", content: "", artifact: null },
    ]);
    setStreamHint(null);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, stream: true, aiAgentId: selectedAgentId }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Request failed");
      }
      if (!ct.includes("text/event-stream")) {
        const data = (await res.json()) as {
          error?: string;
          sessionId?: string;
          reply?: string;
          artifactMarkdown?: string | null;
        };
        if (data.error) throw new Error(data.error);
        if (data.sessionId) {
          setSessionId(data.sessionId);
          if (hadNoSession && data.sessionId) {
            router.replace(`/assistant?session=${data.sessionId}`);
          }
        }
        setLines((prev) =>
          prev.map((l) =>
            l.id === assistantId
              ? {
                  ...l,
                  content: data.reply ?? "",
                  artifact: data.artifactMarkdown ?? null,
                }
              : l
          )
        );
        if (data.artifactMarkdown) setArtifact(data.artifactMarkdown);
        return;
      }

      await consumeAssistantSse(res, {
        onMeta: (sid) => setSessionId(sid),
        onDelta: (chunk) => {
          setStreamHint(null);
          setLines((prev) =>
            prev.map((l) => (l.id === assistantId ? { ...l, content: l.content + chunk } : l))
          );
        },
        onStatus: (message) => setStreamHint(message),
        onDone: ({ sessionId: sid, reply, artifactMarkdown }) => {
          setSessionId(sid);
          setStreamHint(null);
          setLines((prev) =>
            prev.map((l) =>
              l.id === assistantId ? { ...l, content: reply, artifact: artifactMarkdown ?? null } : l
            )
          );
          if (artifactMarkdown) setArtifact(artifactMarkdown);
          if (hadNoSession && sid) {
            router.replace(`/assistant?session=${sid}`);
          }
        },
        onError: ({ error }) => {
          throw new Error(error);
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setLines((prev) =>
        prev.filter(
          (l) => !(l.id === assistantId && l.role === "assistant" && l.content.trim() === "")
        )
      );
    } finally {
      setBusy(false);
      setStreamHint(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <Card className="w-full shrink-0 border-border bg-card xl:sticky xl:top-4 xl:w-56 xl:max-h-[calc(100vh-6rem)]">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            Chats
          </CardTitle>
          <p className="text-xs text-muted-foreground">Saved per account. Refresh keeps the open thread.</p>
        </CardHeader>
        <CardContent className="p-2">
          <Link
            href="/assistant?new=true"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "mb-2 w-full justify-start rounded-lg no-underline"
            )}
          >
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            New chat
          </Link>
          <ScrollArea className="h-[min(360px,40vh)] xl:h-[min(420px,calc(100vh-14rem))]">
            <div className="space-y-1 pr-2">
              {sessions.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No history yet — send a message to start.</p>
              ) : (
                sessions.map((s) => {
                  const active = !forceNewChat && sessionId === s.id;
                  return (
                    <Link
                      key={s.id}
                      href={`/assistant?session=${s.id}`}
                      className={cn(
                        "block rounded-lg border border-transparent px-2 py-2 text-left text-sm transition-colors hover:bg-secondary/60",
                        active && "border-primary/20 bg-primary/10"
                      )}
                    >
                      <span className="line-clamp-2 font-medium leading-snug">
                        {s.title?.trim() || "Untitled chat"}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                        {formatYmdHm(s.updated_at)}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="flex min-h-[520px] min-w-0 flex-1 flex-col border-border bg-card">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Workplace assistant
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Choose a governed agent from Agent studio for its instructions and knowledge scope, or use the workspace
            assistant for the full knowledge base. Tools run on the server with tenant isolation.
          </p>
          {agents.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label htmlFor="assistant-agent" className="text-xs font-medium text-muted-foreground shrink-0">
                Agent
              </label>
              <select
                id="assistant-agent"
                className="h-9 w-full max-w-md rounded-xl border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={selectedAgentId ?? ""}
                onChange={(e) => {
                  if (busy || !canChat) return;
                  const next = e.target.value || null;
                  const qs = new URLSearchParams();
                  qs.set("new", "true");
                  if (next) qs.set("agent", next);
                  router.replace(`/assistant?${qs.toString()}`);
                }}
                disabled={busy || !canChat}
              >
                <option value="">Workspace assistant (full knowledge)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.status === "draft" ? " (draft)" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 p-0">
          {!canChat ? (
            <p className="mx-6 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
              {!openAiConfigured ? (
                <>
                  <strong className="font-semibold">OpenAI is not configured</strong> — set{" "}
                  <code className="rounded bg-background/60 px-1 font-mono">OPENAI_API_KEY</code>.
                </>
              ) : (
                <>
                  <strong className="font-semibold">AI copilot is off</strong> — enable under Settings → AI automation.
                </>
              )}
            </p>
          ) : null}
          <ScrollArea className="min-h-[300px] flex-1 px-6 py-4">
            <div className="space-y-4">
              {lines.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Try: “Summarize operations”, “Search knowledge for refunds”, “List my surveys”, or “Get module MCQ
                  index 0 for my assigned course”.
                </p>
              )}
              {lines.map((l) => (
                <div
                  key={l.id}
                  className={
                    l.role === "user"
                      ? "ml-6 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm"
                      : "mr-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm"
                  }
                >
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {l.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div className="whitespace-pre-wrap">{l.content}</div>
                  {l.artifact && l.role === "assistant" && (
                    <Button
                      type="button"
                      variant="link"
                      className="mt-2 h-auto p-0 text-xs"
                      onClick={() => setArtifact(l.artifact!)}
                    >
                      Show report in panel →
                    </Button>
                  )}
                </div>
              ))}
              {busy ? (
                <div className="text-xs text-muted-foreground">{streamHint ?? "Thinking…"}</div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
          <div className="flex gap-2 border-t border-border p-4">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask anything…"
              disabled={busy || !canChat}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
              className="rounded-xl"
            />
            <Button
              type="button"
              className="rounded-xl shrink-0"
              disabled={busy || !canChat}
              onClick={() => void send()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="w-full shrink-0 border-border bg-card xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)] xl:w-[min(100%,420px)] xl:overflow-hidden">
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <PanelRight className="h-4 w-4 text-primary" />
            Insight panel
          </CardTitle>
          <p className="text-xs text-muted-foreground">Markdown briefings and tables from the assistant.</p>
        </CardHeader>
        <CardContent className="max-h-[420px] overflow-y-auto p-4 xl:max-h-[calc(100vh-12rem)]">
          {artifact ? (
            <MarkdownArtifact source={artifact} />
          ) : (
            <p className="text-sm text-muted-foreground">No report yet. Ask for a dashboard-style summary.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
