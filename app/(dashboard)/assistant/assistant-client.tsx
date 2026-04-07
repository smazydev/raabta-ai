"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Mic, MicOff, PanelRight, PhoneOff, Radio, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownArtifact } from "@/components/assistant/markdown-artifact";
import { cn, randomId } from "@/lib/utils";
import { formatYmdHm } from "@/lib/format-date";
import { END_VOICE_SESSION_TOOL_NAME } from "@/lib/assistant/realtime-tools";

type Line = {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifact?: string | null;
  /** Set for lines captured from OpenAI Realtime in this session (not loaded from DB). */
  viaVoice?: boolean;
};

type VoicePhase = "idle" | "listening" | "working" | "replying" | "tools";

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

function parseConversationItemDone(evt: Record<string, unknown>): {
  role: "user" | "assistant";
  text: string;
  dedupeKey: string;
} | null {
  if (evt.type !== "conversation.item.done") return null;
  const item = evt.item as Record<string, unknown> | undefined;
  if (!item) return null;
  const role = item.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = item.content;
  if (!Array.isArray(content)) return null;
  const chunks: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const t = p.type;
    if (
      (t === "input_text" || t === "text" || t === "output_text") &&
      typeof p.text === "string"
    ) {
      chunks.push(p.text);
    }
    if (
      (t === "input_audio" || t === "audio" || t === "output_audio") &&
      typeof p.transcript === "string"
    ) {
      chunks.push(p.transcript);
    }
  }
  const text = chunks.join(" ").trim();
  if (!text) return null;
  const id = typeof item.id === "string" ? item.id : null;
  const dedupeKey = id ? `convitem:${id}` : `fallback:${role}:${text.slice(0, 120)}`;
  return { role, text, dedupeKey };
}

/** Normalizes `response.output` items from Realtime (shape differs between WebSocket vs WebRTC). */
function extractFunctionCallsFromResponseOutput(output: unknown): {
  call_id: string;
  name: string;
  arguments: string;
}[] {
  if (!Array.isArray(output)) return [];
  const out: { call_id: string; name: string; arguments: string }[] = [];
  const pushCall = (obj: Record<string, unknown>) => {
    if (obj.type !== "function_call") return;
    const call_id = String(obj.call_id ?? "");
    const name = String(obj.name ?? "");
    let argStr = "{}";
    if (typeof obj.arguments === "string") argStr = obj.arguments;
    else if (obj.arguments != null) argStr = JSON.stringify(obj.arguments);
    if (call_id && name) out.push({ call_id, name, arguments: argStr });
  };
  for (const raw of output) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    pushCall(o);
    const nested = o.item;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      pushCall(nested as Record<string, unknown>);
    }
  }
  return out;
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

  const [voiceLive, setVoiceLive] = React.useState(false);
  const [voiceConnecting, setVoiceConnecting] = React.useState(false);
  const [voicePhase, setVoicePhase] = React.useState<VoicePhase | null>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const voiceStreamRef = React.useRef<MediaStream | null>(null);
  const remoteAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const voiceItemsSeenRef = React.useRef<Set<string>>(new Set());
  const voicePersistToastSentRef = React.useRef(false);
  const endVoiceAwaitingTargetResponseRef = React.useRef(false);
  const endVoiceTargetResponseIdRef = React.useRef<string | null>(null);
  const endVoiceFallbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopVoiceSessionRef = React.useRef<() => void>(() => {});
  const sessionIdRef = React.useRef<string | null>(sessionId);

  React.useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  React.useEffect(() => {
    setSelectedAgentId(initialAiAgentId);
  }, [initialAiAgentId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, busy, voicePhase, voiceLive]);

  const clearVoiceEndScheduling = React.useCallback(() => {
    endVoiceAwaitingTargetResponseRef.current = false;
    endVoiceTargetResponseIdRef.current = null;
    if (endVoiceFallbackTimerRef.current) {
      clearTimeout(endVoiceFallbackTimerRef.current);
      endVoiceFallbackTimerRef.current = null;
    }
  }, []);

  const stopVoiceSession = React.useCallback(() => {
    clearVoiceEndScheduling();
    voiceItemsSeenRef.current.clear();
    voicePersistToastSentRef.current = false;
    pcRef.current?.close();
    pcRef.current = null;
    for (const t of voiceStreamRef.current?.getTracks() ?? []) t.stop();
    voiceStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setVoiceLive(false);
    setVoiceConnecting(false);
    setVoicePhase(null);
  }, [clearVoiceEndScheduling]);

  React.useEffect(() => {
    stopVoiceSessionRef.current = stopVoiceSession;
  }, [stopVoiceSession]);

  React.useEffect(() => () => stopVoiceSession(), [stopVoiceSession]);

  async function persistVoiceLine(role: "user" | "assistant", text: string): Promise<boolean> {
    const sid = sessionIdRef.current;
    if (!sid) return false;
    try {
      const res = await fetch("/api/assistant/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, role, text }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        sessionTitleUpdated?: boolean;
        error?: string;
      };
      if (!res.ok) {
        if (!voicePersistToastSentRef.current) {
          voicePersistToastSentRef.current = true;
          toast.error(data.error || "Could not save voice turn to chat history");
        }
        return false;
      }
      if (data.sessionTitleUpdated) {
        router.refresh();
      }
      return true;
    } catch {
      if (!voicePersistToastSentRef.current) {
        voicePersistToastSentRef.current = true;
        toast.error("Could not save voice turn to chat history");
      }
      return false;
    }
  }

  const voiceMicAllowed = React.useMemo(() => {
    if (!selectedAgentId) return true;
    const a = agents.find((x) => x.id === selectedAgentId);
    if (!a) return true;
    return a.kind === "voice" || a.kind === "both";
  }, [selectedAgentId, agents]);

  async function startVoiceSession() {
    if (!canChat || busy || voiceConnecting || voiceLive) return;
    if (!voiceMicAllowed) {
      toast.error(
        "Voice is only for agents set to Voice or Chat & voice in Agent studio — or use workspace assistant."
      );
      return;
    }
    setVoiceConnecting(true);
    voiceItemsSeenRef.current.clear();

    try {
      let sid = sessionId;
      if (!sid) {
        const res = await fetch("/api/assistant/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aiAgentId: selectedAgentId }),
        });
        const data = (await res.json()) as { sessionId?: string; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not start session");
        if (!data.sessionId) throw new Error("No session id");
        sid = data.sessionId;
        sessionIdRef.current = sid;
        setSessionId(sid);
        router.replace(`/assistant?session=${sid}`);
      }

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = ms;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const el = remoteAudioRef.current;
        if (el) {
          el.autoplay = true;
          el.srcObject = e.streams[0];
        }
      };

      const micTrack = ms.getAudioTracks()[0];
      if (!micTrack) throw new Error("No microphone track");
      pc.addTrack(micTrack);

      const dc = pc.createDataChannel("oai-events");
      const processedToolCallIds = new Set<string>();
      const pendingToolNameByCallId = new Map<string, string>();
      const pendingToolArgsByCallId = new Map<string, string>();
      const processedResponseDoneIds = new Set<string>();
      const agentIdForVoice = selectedAgentId;
      let dcQueue: Promise<void> = Promise.resolve();

      const sendDc = (obj: unknown) => {
        if (dc.readyState === "open") {
          dc.send(JSON.stringify(obj));
        }
      };

      async function sendSingleToolOutput(callId: string, fn: string, argStr: string) {
        if (fn === END_VOICE_SESSION_TOOL_NAME) {
          if (endVoiceFallbackTimerRef.current) {
            clearTimeout(endVoiceFallbackTimerRef.current);
            endVoiceFallbackTimerRef.current = null;
          }
          endVoiceAwaitingTargetResponseRef.current = true;
          endVoiceTargetResponseIdRef.current = null;
          endVoiceFallbackTimerRef.current = setTimeout(() => {
            endVoiceFallbackTimerRef.current = null;
            clearVoiceEndScheduling();
            stopVoiceSessionRef.current();
          }, 12_000);
          sendDc({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                result:
                  "End the voice session after one short closing line in the user’s language. Do not start new topics.",
              }),
            },
          });
          return;
        }
        try {
          const res = await fetch("/api/assistant/realtime-tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              aiAgentId: agentIdForVoice,
              name: fn,
              arguments: argStr,
            }),
          });
          const data = (await res.json()) as {
            output?: string;
            artifactMarkdown?: string | null;
            error?: string;
          };
          if (typeof data.artifactMarkdown === "string" && data.artifactMarkdown.trim()) {
            setArtifact(data.artifactMarkdown);
          }
          const outPayload =
            res.ok && typeof data.output === "string"
              ? JSON.stringify({ result: data.output })
              : JSON.stringify({ error: data.error || "Tool execution failed" });
          sendDc({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output: outPayload },
          });
        } catch {
          sendDc({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({ error: "Could not reach tool server" }),
            },
          });
        }
      }

      async function tryRunStreamTool(callId: string) {
        if (processedToolCallIds.has(callId)) {
          pendingToolNameByCallId.delete(callId);
          pendingToolArgsByCallId.delete(callId);
          return;
        }
        const name = pendingToolNameByCallId.get(callId);
        const args = pendingToolArgsByCallId.get(callId);
        if (!callId || !name || args == null) return;
        processedToolCallIds.add(callId);
        pendingToolNameByCallId.delete(callId);
        pendingToolArgsByCallId.delete(callId);
        setVoicePhase("tools");
        await sendSingleToolOutput(callId, name, args);
        sendDc({ type: "response.create" });
        setVoicePhase("working");
      }

      function registerFunctionCallMeta(callId: string, name: string) {
        if (!callId || !name) return;
        pendingToolNameByCallId.set(callId, name);
        void tryRunStreamTool(callId);
      }

      const flushVoiceEvent = async (raw: string) => {
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }

        const typ = typeof evt.type === "string" ? evt.type : "";

        if (typ === "input_audio_buffer.speech_started") {
          setVoicePhase("listening");
          return;
        }
        if (typ === "input_audio_buffer.speech_stopped") {
          setVoicePhase("working");
          return;
        }
        if (typ === "response.created") {
          setVoicePhase("working");
          if (endVoiceAwaitingTargetResponseRef.current) {
            const resp = evt.response as Record<string, unknown> | undefined;
            const rid = typeof resp?.id === "string" ? resp.id : null;
            if (rid) {
              endVoiceTargetResponseIdRef.current = rid;
              endVoiceAwaitingTargetResponseRef.current = false;
            }
          }
          return;
        }
        if (typ === "response.output_audio_transcript.delta" || typ === "response.audio_transcript.delta") {
          setVoicePhase("replying");
          return;
        }

        if (typ === "response.output_item.added" || typ === "response.output_item.done") {
          const item = evt.item as Record<string, unknown> | undefined;
          if (item && item.type === "function_call") {
            const callId = String(item.call_id ?? "");
            const name = String(item.name ?? "");
            registerFunctionCallMeta(callId, name);
          }
          return;
        }

        if (typ === "response.function_call_arguments.done") {
          const callId = String(evt.call_id ?? "");
          const argStr = typeof evt.arguments === "string" ? evt.arguments : "{}";
          if (!callId) return;
          pendingToolArgsByCallId.set(callId, argStr);
          void tryRunStreamTool(callId);
          return;
        }

        if (typ === "conversation.item.input_audio_transcription.completed") {
          const transcript = typeof evt.transcript === "string" ? evt.transcript.trim() : "";
          const itemId = typeof evt.item_id === "string" ? evt.item_id : "";
          if (!transcript || !itemId) return;
          const dedupeKey = `convitem:${itemId}`;
          if (voiceItemsSeenRef.current.has(dedupeKey)) return;
          voiceItemsSeenRef.current.add(dedupeKey);
          setLines((prev) => [
            ...prev,
            {
              id: randomId(),
              role: "user" as const,
              content: transcript,
              artifact: null,
              viaVoice: true,
            },
          ]);
          await persistVoiceLine("user", transcript);
          return;
        }

        if (typ === "response.audio_transcript.done" || typ === "response.output_audio_transcript.done") {
          const transcript = typeof evt.transcript === "string" ? evt.transcript.trim() : "";
          const itemId = typeof evt.item_id === "string" ? evt.item_id : "";
          if (!transcript || !itemId) return;
          const dedupeKey = `convitem:${itemId}`;
          if (voiceItemsSeenRef.current.has(dedupeKey)) return;
          voiceItemsSeenRef.current.add(dedupeKey);
          setLines((prev) => [
            ...prev,
            {
              id: randomId(),
              role: "assistant" as const,
              content: transcript,
              artifact: null,
              viaVoice: true,
            },
          ]);
          await persistVoiceLine("assistant", transcript);
          return;
        }

        const itemDone = parseConversationItemDone(evt);
        if (itemDone) {
          if (voiceItemsSeenRef.current.has(itemDone.dedupeKey)) return;
          voiceItemsSeenRef.current.add(itemDone.dedupeKey);

          setLines((prev) => [
            ...prev,
            {
              id: randomId(),
              role: itemDone.role,
              content: itemDone.text,
              artifact: null,
              viaVoice: true,
            },
          ]);

          await persistVoiceLine(itemDone.role, itemDone.text);
          return;
        }

        if (evt.type === "response.done") {
          const resp = evt.response as Record<string, unknown> | undefined;
          const rid = typeof resp?.id === "string" ? resp.id : null;
          if (rid && endVoiceTargetResponseIdRef.current === rid) {
            endVoiceTargetResponseIdRef.current = null;
            endVoiceAwaitingTargetResponseRef.current = false;
            if (endVoiceFallbackTimerRef.current) {
              clearTimeout(endVoiceFallbackTimerRef.current);
              endVoiceFallbackTimerRef.current = null;
            }
            stopVoiceSessionRef.current();
            return;
          }
          const output = resp?.output;

          const calls = extractFunctionCallsFromResponseOutput(output);
          const pending = calls.filter((c) => c.call_id && !processedToolCallIds.has(c.call_id));

          if (pending.length > 0) {
            if (rid && processedResponseDoneIds.has(rid)) {
              setVoicePhase("idle");
              return;
            }
            if (rid) processedResponseDoneIds.add(rid);
            setVoicePhase("tools");
            for (const c of pending) {
              processedToolCallIds.add(c.call_id);
              pendingToolNameByCallId.delete(c.call_id);
              pendingToolArgsByCallId.delete(c.call_id);
              await sendSingleToolOutput(c.call_id, c.name, c.arguments);
            }
            sendDc({ type: "response.create" });
            setVoicePhase("working");
            return;
          }

          setVoicePhase("idle");
          return;
        }

        if (evt.type === "error") {
          const msg =
            typeof evt.error === "object" && evt.error !== null && "message" in evt.error
              ? String((evt.error as { message?: string }).message)
              : "Voice session error";
          toast.error(msg);
        }
      };

      dc.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        dcQueue = dcQueue.then(() => flushVoiceEvent(e.data)).catch(() => {});
      };
      dc.onerror = () => toast.error("Voice data channel error");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const qs = new URLSearchParams();
      if (selectedAgentId) qs.set("aiAgentId", selectedAgentId);
      const url = `/api/assistant/realtime-calls${qs.size ? `?${qs.toString()}` : ""}`;

      const sdpRes = await fetch(url, {
        method: "POST",
        body: offer.sdp ?? "",
        headers: { "Content-Type": "application/sdp" },
      });

      if (!sdpRes.ok) {
        const errBody = (await sdpRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Voice connect failed (${sdpRes.status})`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setVoiceLive(true);
      setVoicePhase("idle");
      toast.success("Voice active — your turns are saved in this chat");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Voice failed");
      stopVoiceSession();
    } finally {
      setVoiceConnecting(false);
    }
  }

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
            Choose a governed agent from Agent studio for instructions and knowledge (bases + articles attach per agent).
            Text chat always works; <strong className="font-medium text-foreground">voice</strong> uses OpenAI Realtime
            with the same tools, Urdu/English, and optional Sindhi/Pashto when enabled for the deployment. Chat-only
            agents cannot start voice — set Channel coverage to Voice or Chat &amp; voice in Agent studio.
          </p>
          {agents.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
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
                  disabled={busy || !canChat || voiceLive}
                >
                  <option value="">Workspace assistant (full knowledge · voice OK)</option>
                  {agents.map((a) => {
                    const ch =
                      a.kind === "voice" ? "voice" : a.kind === "both" ? "chat+voice" : "chat only";
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name} ({ch})
                        {a.status === "draft" ? " · draft" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              {selectedAgentId && !voiceMicAllowed ? (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  This agent is chat-only — voice needs Voice or Chat &amp; voice in Agent studio.
                </p>
              ) : null}
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
          {canChat && (voiceConnecting || voiceLive) ? (
            <div
              className={cn(
                "mx-6 mt-4 flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                voiceConnecting
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-emerald-600/35 bg-emerald-500/10 dark:border-emerald-500/30 dark:bg-emerald-950/30"
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    voiceConnecting ? "bg-amber-500/25 text-amber-900 dark:text-amber-100" : "bg-emerald-600/20 text-emerald-900 dark:text-emerald-100"
                  )}
                >
                  {voiceConnecting ? (
                    <Sparkles className="h-4 w-4 animate-pulse" />
                  ) : (
                    <Radio
                      className={cn(
                        "h-4 w-4",
                        voicePhase === "listening" || voicePhase === "replying" ? "animate-pulse" : ""
                      )}
                    />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight text-foreground">
                    {voiceConnecting ? "Connecting voice…" : "Voice agent active"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {voiceConnecting
                      ? "Setting up microphone and realtime session."
                      : voicePhase === "listening"
                        ? "Listening — speak now."
                        : voicePhase === "working"
                          ? "Working on a reply…"
                          : voicePhase === "replying"
                            ? "Assistant is speaking — listen or interrupt by speaking."
                            : voicePhase === "tools"
                              ? "Using workspace tools (knowledge, metrics, etc.)…"
                              : "Connected — your turns are saved in this chat thread. Speak when ready."}
                  </p>
                </div>
              </div>
              {voiceLive ? (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg border-emerald-700/30 bg-background/90 text-emerald-950 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-50 dark:hover:bg-emerald-950/50"
                    onClick={stopVoiceSession}
                  >
                    <PhoneOff className="mr-2 h-4 w-4" />
                    End voice
                  </Button>
                  <Badge
                    variant="outline"
                    className="border-emerald-600/40 bg-background/80 text-emerald-900 dark:border-emerald-500/40 dark:text-emerald-100"
                  >
                    Live call
                  </Badge>
                </div>
              ) : null}
            </div>
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
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span>{l.role === "user" ? "You" : "Assistant"}</span>
                    {l.viaVoice ? (
                      <Badge
                        variant="secondary"
                        className="h-5 px-1.5 py-0 text-[9px] font-semibold normal-case tracking-normal"
                      >
                        Voice
                      </Badge>
                    ) : null}
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
          <audio ref={remoteAudioRef} className="hidden" playsInline />
          <div className="flex gap-2 border-t border-border p-4">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={voiceLive ? "End voice to type…" : "Ask anything…"}
              disabled={busy || !canChat || voiceLive}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
              className="rounded-xl"
            />
            {voiceLive ? (
              <Button
                type="button"
                variant="destructive"
                className="rounded-xl shrink-0 gap-1.5 px-3"
                onClick={stopVoiceSession}
                title="End voice — microphone disconnects"
              >
                <MicOff className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">End voice</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="rounded-xl shrink-0"
                disabled={busy || !canChat || voiceConnecting || !voiceMicAllowed}
                onClick={() => void startVoiceSession()}
                title={
                  voiceMicAllowed
                    ? "Voice conversation — tools + knowledge (Realtime)"
                    : "Pick a voice-capable agent or workspace assistant"
                }
              >
                <Mic className={`h-4 w-4 ${voiceConnecting ? "animate-pulse" : ""}`} />
              </Button>
            )}
            <Button
              type="button"
              className="rounded-xl shrink-0"
              disabled={busy || !canChat || voiceLive}
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
