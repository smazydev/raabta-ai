"use client";

import * as React from "react";
import { toast } from "sonner";
import { MessageSquare, Send, Volume2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CHAT_LANGUAGE_OPTIONS,
  type ChatLanguage,
} from "@/lib/ai/chat-languages";
import { playOpenAiTts } from "@/lib/play-openai-tts";
import { randomId } from "@/lib/utils";

type DemoConversation = {
  id: string;
  summary: string | null;
  intent: string | null;
  channel: string;
  customerName: string | null;
};

type ChatLine = {
  id: string;
  sender: "customer" | "ai";
  body: string;
};

export function DemoWidget({
  romanUrduSupport,
  openAiConfigured,
  aiAutoReplyEnabled,
  aiChatEnabled,
  aiTtsEnabled,
  conversations,
}: {
  romanUrduSupport: boolean;
  openAiConfigured: boolean;
  aiAutoReplyEnabled: boolean;
  aiChatEnabled: boolean;
  aiTtsEnabled: boolean;
  conversations: DemoConversation[];
}) {
  const canUseTts = openAiConfigured && aiTtsEnabled;
  const [selectedId, setSelectedId] = React.useState<string>(conversations[0]?.id ?? "");
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [ttsBusy, setTtsBusy] = React.useState(false);
  const [history, setHistory] = React.useState<Record<string, ChatLine[]>>({});
  const [replyLanguage, setReplyLanguage] = React.useState<ChatLanguage>("ur");
  const [speakReplies, setSpeakReplies] = React.useState(false);

  const selected = React.useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const lines = history[selectedId] ?? [];

  const ttsOpts = React.useCallback(
    (): { language: ChatLanguage; romanUrdu: boolean } => ({
      language: replyLanguage,
      romanUrdu: replyLanguage === "ur" && romanUrduSupport,
    }),
    [replyLanguage, romanUrduSupport]
  );

  async function speakLine(body: string) {
    if (!canUseTts) return;
    setTtsBusy(true);
    try {
      await playOpenAiTts(body, ttsOpts());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Voice playback failed");
    } finally {
      setTtsBusy(false);
    }
  }

  async function sendMessage() {
    if (!selectedId) {
      toast.error("Select a conversation first");
      return;
    }
    const message = draft.trim();
    if (!message) return;

    setSending(true);
    setDraft("");
    const localId = randomId();
    setHistory((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), { id: localId, sender: "customer", body: message }],
    }));

    try {
      const res = await fetch("/api/overview/demo-message", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedId,
          message,
          language: replyLanguage,
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      const reply = data.reply ?? "";
      setHistory((prev) => ({
        ...prev,
        [selectedId]: [...(prev[selectedId] ?? []), { id: randomId(), sender: "ai", body: reply }],
      }));
      if (speakReplies && canUseTts) {
        try {
          await playOpenAiTts(reply, ttsOpts());
        } catch (ttsErr) {
          toast.error(ttsErr instanceof Error ? ttsErr.message : "Voice playback failed");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Message failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-primary" />
          Sandbox: conversational turn simulator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!aiChatEnabled ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
            {!openAiConfigured ? (
              <>
                <strong className="font-semibold">OpenAI is not configured</strong> on the server — sandbox sends will
                fail until <code className="rounded bg-background/60 px-1 font-mono">OPENAI_API_KEY</code> is set.
              </>
            ) : !aiAutoReplyEnabled ? (
              <>
                <strong className="font-semibold">AI replies are off</strong> for this tenant. Turn them on under{" "}
                <span className="font-medium">Settings → AI automation</span>.
              </>
            ) : null}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="overview-reply-lang">
              AI reply language
            </label>
            <select
              id="overview-reply-lang"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={replyLanguage}
              onChange={(e) => setReplyLanguage(e.target.value as ChatLanguage)}
              disabled={sending}
            >
              {CHAT_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <label
            className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
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
              checked={speakReplies}
              onChange={(e) => setSpeakReplies(e.target.checked)}
              disabled={sending || !canUseTts}
            />
            Read AI replies aloud
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className="rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-secondary/40"
            >
              <p className="font-semibold">{c.customerName?.trim() || "Unknown"}</p>
              <p className="text-muted-foreground">{c.intent ?? "general_query"}</p>
            </button>
          ))}
        </div>

        {selected ? (
          <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{selected.customerName?.trim() || "Unknown"}</p>
              <Badge variant="outline" className="text-[10px] uppercase">
                {selected.channel.replace("_", " ")}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {selected.summary ?? "No summary available for this thread."}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No conversation available for demo.</p>
        )}

        <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border p-3">
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Exercise the stack end-to-end: each send hits tenant-scoped AI + knowledge retrieval (not production
              traffic).
            </p>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className={
                  line.sender === "customer"
                    ? "ml-auto max-w-[90%] rounded-lg bg-secondary/50 px-3 py-2 text-right text-sm"
                    : "mr-auto max-w-[90%] rounded-lg bg-primary/5 px-3 py-2 text-left text-sm"
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] uppercase text-muted-foreground">{line.sender}</p>
                  {line.sender === "ai" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={sending || ttsBusy || !canUseTts}
                      aria-label="Play reply aloud"
                      onClick={() => void speakLine(line.body)}
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
                <p className="pr-1">{line.body}</p>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Type a customer message…"
            disabled={!selectedId || sending || !aiChatEnabled}
          />
          <Button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!selectedId || sending || !draft.trim() || !aiChatEnabled}
            title={
              !aiChatEnabled
                ? !openAiConfigured
                  ? "Configure OPENAI_API_KEY"
                  : "Enable AI replies in Settings → AI automation"
                : undefined
            }
          >
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
