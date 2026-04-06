"use client";

import * as React from "react";
import { Mic, MicOff, PhoneCall, Search, Languages } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SessionRow = {
  id: string;
  preferred_language: string | null;
  detected_intent: string | null;
  status: string;
  outcome: string | null;
  transfer_reason: string | null;
  summary: string | null;
  created_at: string;
  disposition: unknown;
};

type SpeechRecognitionApi = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechWindow = Window & {
  webkitSpeechRecognition?: new () => SpeechRecognitionApi;
  SpeechRecognition?: new () => SpeechRecognitionApi;
};

export function FrontdeskClient({
  openAiConfigured,
  voiceFrontdeskAiEnabled,
  initialSessions,
  stats,
}: {
  openAiConfigured: boolean;
  voiceFrontdeskAiEnabled: boolean;
  initialSessions: SessionRow[];
  stats: {
    total: number;
    transferred: number;
    resolvedWithoutTransfer: number;
    callbacks: number;
  };
}) {
  const canLlm = openAiConfigured && voiceFrontdeskAiEnabled;
  const [sessions] = React.useState(initialSessions);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [languageFilter, setLanguageFilter] = React.useState<"all" | "ur" | "sd" | "ps">("all");
  const [query, setQuery] = React.useState("");
  const [turns, setTurns] = React.useState<{ actor: "caller" | "assistant"; text: string }[]>([]);
  const [selectedSession, setSelectedSession] = React.useState<SessionRow | null>(null);
  const [selectedTurns, setSelectedTurns] = React.useState<
    { id: string; actor: string; language: string | null; text: string; redacted_text: string | null }[]
  >([]);
  const [selectedRequests, setSelectedRequests] = React.useState<
    { id: string; request_type: string; status: string; external_ref: string | null }[]
  >([]);
  const recognitionRef = React.useRef<SpeechRecognitionApi | null>(null);

  const filtered = sessions.filter((s) => {
    const langOk = languageFilter === "all" || s.preferred_language === languageFilter;
    const q = query.trim().toLowerCase();
    const qOk = !q || `${s.summary ?? ""} ${s.detected_intent ?? ""} ${s.status}`.toLowerCase().includes(q);
    return langOk && qOk;
  });

  async function startSession() {
    setBusy(true);
    try {
      const res = await fetch("/api/voice-frontdesk/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setActiveSessionId(data.id);
      toast.success("Front-desk session started");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function sendTurn() {
    if (!canLlm) return toast.error("Voice desk AI is off or OpenAI is not configured");
    if (!activeSessionId) return toast.error("Start a session first");
    const utterance = draft.trim();
    if (!utterance) return;
    setBusy(true);
    setDraft("");
    setTurns((p) => [...p, { actor: "caller", text: utterance }]);
    try {
      const res = await fetch(`/api/voice-frontdesk/sessions/${activeSessionId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setTurns((p) => [...p, { actor: "assistant", text: data.responseText }]);
      toast.success(
        data.shouldEndCall
          ? "Caller ended the conversation"
          : data.shouldEscalate
            ? `Escalated: ${data.escalationReason ?? "human transfer"}`
            : `Intent: ${data.intent}`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Turn failed");
    } finally {
      setBusy(false);
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function startListening() {
    if (!canLlm) {
      toast.error("Voice desk AI is off or OpenAI is not configured");
      return;
    }
    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      toast.error("Speech recognition not supported in browser");
      return;
    }
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "ur-PK";
    rec.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result?.[0]?.transcript ?? "";
      if (transcript) setDraft(transcript);
    };
    rec.onerror = () => {
      toast.error("Could not capture voice");
      stopListening();
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  React.useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  async function openSessionDetail(id: string) {
    try {
      const res = await fetch(`/api/voice-frontdesk/sessions/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSelectedSession(data.session as SessionRow);
      setSelectedTurns(data.turns ?? []);
      setSelectedRequests(data.requests ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load session");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border bg-card"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total sessions</p><p className="font-mono text-3xl font-bold">{stats.total}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Transferred</p><p className="font-mono text-3xl font-bold">{stats.transferred}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Resolved no transfer</p><p className="font-mono text-3xl font-bold">{stats.resolvedWithoutTransfer}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Callback requests</p><p className="font-mono text-3xl font-bold">{stats.callbacks}</p></CardContent></Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Live front-desk simulator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canLlm ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
              {!openAiConfigured ? (
                <strong className="font-semibold">OpenAI is not configured</strong>
              ) : (
                <>
                  <strong className="font-semibold">Voice desk LLM is off</strong> — enable in Settings → AI automation.
                </>
              )}
            </p>
          ) : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Start session creates the call record only (no microphone). After that, click the mic to dictate into the
            field (Chrome or Edge; uses browser speech-to-text, not Firefox), or type and press Send turn. The server
            only receives text, not raw audio.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={startSession} disabled={busy}>
              <PhoneCall className="mr-2 h-4 w-4" />
              Start session
            </Button>
            <Button
              type="button"
              size="icon"
              variant={listening ? "destructive" : "secondary"}
              onClick={listening ? stopListening : startListening}
              disabled={busy || !activeSessionId || !canLlm}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendTurn();
                }
              }}
              placeholder="Speak or type caller utterance..."
              disabled={busy || !activeSessionId || !canLlm}
            />
            <Button
              onClick={() => void sendTurn()}
              disabled={busy || !activeSessionId || !draft.trim() || !canLlm}
            >
              Send turn
            </Button>
          </div>
          <div className="max-h-64 space-y-2 overflow-auto rounded-lg border border-border p-3">
            {turns.length === 0 ? (
              <p className="text-xs text-muted-foreground">No turns yet.</p>
            ) : (
              turns.map((t, i) => (
                <div key={i} className={t.actor === "caller" ? "text-right" : "text-left"}>
                  <p className="text-[10px] uppercase text-muted-foreground">{t.actor}</p>
                  <p className="text-sm">{t.text}</p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Recent voice sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-72 max-w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="Search summary/intent/status" />
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
              <Languages className="h-3 w-3" />
              <button type="button" onClick={() => setLanguageFilter("all")} className={languageFilter === "all" ? "font-bold text-primary" : "text-muted-foreground"}>All</button>
              <button type="button" onClick={() => setLanguageFilter("ur")} className={languageFilter === "ur" ? "font-bold text-primary" : "text-muted-foreground"}>Urdu</button>
              <button type="button" onClick={() => setLanguageFilter("sd")} className={languageFilter === "sd" ? "font-bold text-primary" : "text-muted-foreground"}>Sindhi</button>
              <button type="button" onClick={() => setLanguageFilter("ps")} className={languageFilter === "ps" ? "font-bold text-primary" : "text-muted-foreground"}>Pashto</button>
            </div>
          </div>
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions match current filters.</p>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void openSessionDetail(s.id)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-secondary/30"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{s.preferred_language}</Badge>
                    <Badge variant="outline">{s.detected_intent ?? "unknown"}</Badge>
                    <Badge variant={s.outcome === "transferred" ? "destructive" : "secondary"}>
                      {s.outcome ?? s.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-sm">{s.summary ?? "—"}</p>
                  {s.transfer_reason ? (
                    <p className="mt-1 text-xs text-muted-foreground">Transfer reason: {s.transfer_reason}</p>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Session detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selectedSession ? (
            <p className="text-sm text-muted-foreground">Choose a recent session to view transcript and disposition.</p>
          ) : (
            <>
              <div className="rounded-lg border border-border p-3 text-sm">
                <p><span className="text-muted-foreground">Language:</span> {selectedSession.preferred_language}</p>
                <p><span className="text-muted-foreground">Intent:</span> {selectedSession.detected_intent ?? "—"}</p>
                <p><span className="text-muted-foreground">Outcome:</span> {selectedSession.outcome ?? selectedSession.status}</p>
              </div>
              <div className="max-h-64 space-y-2 overflow-auto rounded-lg border border-border p-3">
                {selectedTurns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No transcript saved.</p>
                ) : (
                  selectedTurns.map((t) => (
                    <div key={t.id} className={t.actor === "caller" ? "text-right" : "text-left"}>
                      <p className="text-[10px] uppercase text-muted-foreground">{t.actor} {t.language ? `(${t.language})` : ""}</p>
                      <p className="text-sm">{t.redacted_text ?? t.text}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="mb-1 font-semibold">Callback / ticket status</p>
                {selectedRequests.length === 0 ? (
                  <p className="text-muted-foreground">No linked requests.</p>
                ) : (
                  selectedRequests.map((r) => (
                    <p key={r.id}>
                      {r.request_type}: {r.status} {r.external_ref ? `(${r.external_ref})` : ""}
                    </p>
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
