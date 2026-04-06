"use client";

import * as React from "react";
import { Send, MessageSquare, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CHAT_LANGUAGE_OPTIONS,
  type ChatLanguage,
} from "@/lib/ai/chat-languages";
import { playOpenAiTts } from "@/lib/play-openai-tts";
import { randomId } from "@/lib/utils";
import { sendDemoChatTurnAction } from "./actions";

type Line = { id: string; sender: "customer" | "ai"; body: string };

export function DemoClient({
  romanUrduSupport,
  openAiConfigured,
  aiAutoReplyEnabled,
  aiChatEnabled,
  aiTtsEnabled,
  chat,
}: {
  romanUrduSupport: boolean;
  openAiConfigured: boolean;
  aiAutoReplyEnabled: boolean;
  aiChatEnabled: boolean;
  aiTtsEnabled: boolean;
  chat: {
    conversationId: string | null;
    customerName: string | null;
    lines: Line[];
  };
}) {
  const [chatDraft, setChatDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [ttsBusy, setTtsBusy] = React.useState(false);
  const [chatLines, setChatLines] = React.useState(chat.lines);
  const [replyLanguage, setReplyLanguage] = React.useState<ChatLanguage>("ur");
  const [speakReplies, setSpeakReplies] = React.useState(false);
  const canUseTts = openAiConfigured && aiTtsEnabled;

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

  async function sendChat() {
    if (!chat.conversationId) return toast.error("No chat conversation found");
    const text = chatDraft.trim();
    if (!text) return;
    setBusy(true);
    setChatDraft("");
    setChatLines((prev) => [...prev, { id: randomId(), sender: "customer", body: text }]);
    try {
      const { reply } = await sendDemoChatTurnAction(chat.conversationId, text, replyLanguage);
      setChatLines((prev) => [...prev, { id: randomId(), sender: "ai", body: reply }]);
      if (speakReplies && canUseTts) {
        try {
          await playOpenAiTts(reply, ttsOpts());
        } catch (ttsErr) {
          toast.error(ttsErr instanceof Error ? ttsErr.message : "Voice playback failed");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              App-channel sandbox thread
            </span>
            <Badge variant="outline">{chat.customerName ?? "Demo customer"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!aiChatEnabled ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
              {!openAiConfigured ? (
                <>
                  <strong className="font-semibold">OpenAI is not configured</strong> — set{" "}
                  <code className="rounded bg-background/60 px-1 font-mono">OPENAI_API_KEY</code> to use this
                  simulator.
                </>
              ) : !aiAutoReplyEnabled ? (
                <>
                  <strong className="font-semibold">AI replies are off</strong> — enable under Settings → AI automation.
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="demo-reply-lang">
                AI reply language
              </label>
              <select
                id="demo-reply-lang"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={replyLanguage}
                onChange={(e) => setReplyLanguage(e.target.value as ChatLanguage)}
                disabled={busy}
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
                disabled={busy || !canUseTts}
              />
              Read AI replies aloud (OpenAI TTS, uses language above)
            </label>
            <span className="block w-full text-[10px] text-muted-foreground">
              If this is off, only the speaker icon on each AI bubble plays audio. TTS follows the written
              reply—Sindhi/Pashto sound best when the model actually writes in that language.
            </span>
            <span className="text-[10px] text-muted-foreground">
              Urdu script vs Roman Urdu: Settings → Roman Urdu support
            </span>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-auto rounded-xl border border-border p-3">
            {chatLines.length === 0 ? (
              <p className="text-xs text-muted-foreground">No messages yet. Start the demo flow below.</p>
            ) : (
              chatLines.map((line) => (
                <div
                  key={line.id}
                  className={
                    line.sender === "customer"
                      ? "ml-auto max-w-[80%] rounded-xl bg-secondary px-3 py-2 text-sm"
                      : "mr-auto max-w-[80%] rounded-xl bg-primary/10 px-3 py-2 text-sm"
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
                        disabled={busy || ttsBusy || !canUseTts}
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
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder="Type as the customer..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendChat();
                }
              }}
              disabled={busy || !aiChatEnabled}
            />
            <Button
              onClick={() => void sendChat()}
              disabled={busy || !chatDraft.trim() || !aiChatEnabled}
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
    </div>
  );
}
