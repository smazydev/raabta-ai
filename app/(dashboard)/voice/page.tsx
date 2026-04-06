import Link from "next/link";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { VoiceClient } from "./voice-client";

export default async function VoicePage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  if (!VOICE_CALLING_ENABLED) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Voice calls</h1>
        <p className="text-sm text-muted-foreground">
          Voice calling is disabled in this build (conversational chat + knowledge base only). Use{" "}
          <Link href="/demo" className="text-primary underline">
            Client Demo
          </Link>{" "}
          or{" "}
          <Link href="/conversations" className="text-primary underline">
            Conversations
          </Link>
          . Re-enable via <code className="text-xs">lib/features.ts</code>.
        </p>
      </div>
    );
  }

  const { supabase, tenantId } = session;

  const { data: callsRaw } = await supabase
    .from("calls")
    .select("id, customer_id, status, duration_seconds, intent, summary, transcript, started_at")
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false });
  const list = dbRows<{
    id: string;
    customer_id: string;
    status: string;
    duration_seconds: number | null;
    intent: string | null;
    summary: string | null;
    transcript: unknown;
    started_at: string;
  }>(callsRaw);
  const cids = [...new Set(list.map((c) => c.customer_id))];
  let customers: { id: string; full_name: string }[] = [];
  if (cids.length) {
    const { data: custRaw } = await supabase.from("customers").select("id, full_name").in("id", cids);
    customers = dbRows<{ id: string; full_name: string }>(custRaw);
  }
  const cmap = new Map(customers.map((c) => [c.id, c]));

  const { data: cardsRaw } = await supabase
    .from("cards")
    .select("id, customer_id, last_four, status")
    .eq("tenant_id", tenantId);
  const cards = dbRows<{ id: string; customer_id: string; last_four: string; status: string }>(cardsRaw);

  const { data: workflowRowsRaw } = await supabase
    .from("workflows")
    .select("id, name, channels, trigger_type")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);
  const workflowRows = dbRows<{ id: string; name: string; channels: unknown; trigger_type: string }>(
    workflowRowsRaw
  );

  const manualWorkflows = workflowRows
    .filter((w) => w.trigger_type === "manual")
    .filter((w) => (Array.isArray(w.channels) ? w.channels : []).includes("voice"))
    .map((w) => ({
      id: w.id,
      name: w.name,
    }));

  const callIds = list.map((c) => c.id);
  const frontdeskTranscriptByCallId = new Map<string, { sender: string; text: string }[]>();
  if (callIds.length) {
    const { data: vfSessions } = await supabase
      .from("voice_frontdesk_sessions")
      .select("id, call_id")
      .eq("tenant_id", tenantId)
      .in("call_id", callIds);
    const sessions = dbRows<{ id: string; call_id: string | null }>(vfSessions).filter((s) => s.call_id);
    const sessionIds = sessions.map((s) => s.id);
    const sessionIdByCallId = new Map(sessions.map((s) => [s.call_id as string, s.id]));
    if (sessionIds.length) {
      const { data: turnsRaw } = await supabase
        .from("voice_frontdesk_turns")
        .select("session_id, actor, text, created_at")
        .eq("tenant_id", tenantId)
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });
      const turns = dbRows<{ session_id: string; actor: string; text: string }>(turnsRaw);
      const bySession = new Map<string, { sender: string; text: string }[]>();
      for (const t of turns) {
        const line = {
          sender: t.actor === "caller" ? "Customer" : "Assistant",
          text: t.text,
        };
        const arr = bySession.get(t.session_id) ?? [];
        arr.push(line);
        bySession.set(t.session_id, arr);
      }
      for (const [callId, sid] of sessionIdByCallId) {
        const lines = bySession.get(sid);
        if (lines?.length) frontdeskTranscriptByCallId.set(callId, lines);
      }
    }
  }

  const rows = list.map((c) => {
    const fd = frontdeskTranscriptByCallId.get(c.id);
    const legacy = Array.isArray(c.transcript) ? (c.transcript as { sender?: string; text?: string }[]) : [];
    const transcriptForUi = fd?.length
      ? fd
      : legacy.length
        ? legacy.map((x) => ({ sender: String(x.sender ?? "—"), text: String(x.text ?? "") }))
        : [];
    return {
      ...c,
      transcript: transcriptForUi,
      customer: cmap.get(c.customer_id) ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Voice control plane</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Call simulator — same orchestration, knowledge, and workflows as chat. For session-level audit, transcript,
            and handoff drill-down, use{" "}
            <Link href="/voice/sessions" className="font-medium text-primary hover:underline">
              Voice sessions
            </Link>
            .
          </p>
        </div>
        <Link
          href="/voice/sessions"
          className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Session registry
        </Link>
      </div>
      <VoiceClient calls={rows} cards={cards} manualWorkflows={manualWorkflows} />
    </div>
  );
}
