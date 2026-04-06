import Link from "next/link";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { FrontdeskClient } from "./frontdesk-client";

export default async function FrontdeskPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  if (!VOICE_CALLING_ENABLED) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Voice Front Desk</h1>
        <p className="text-sm text-muted-foreground">
          Voice front desk is disabled in this build. Use{" "}
          <Link href="/demo" className="text-primary underline">
            Client Demo
          </Link>{" "}
          or{" "}
          <Link href="/conversations" className="text-primary underline">
            Conversations
          </Link>{" "}
          for multilingual KB chat. Re-enable via <code className="text-xs">lib/features.ts</code>.
        </p>
      </div>
    );
  }

  const { supabase, tenantId } = session;
  const tenantAi = await getTenantAiSettings(supabase, tenantId);

  const [{ data: sessionsRaw }, { count: total }, { count: transferred }, { count: callbacks }] =
    await Promise.all([
      supabase
        .from("voice_frontdesk_sessions")
        .select(
          "id, preferred_language, detected_intent, status, outcome, transfer_reason, summary, created_at, disposition"
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("voice_frontdesk_sessions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      supabase
        .from("voice_frontdesk_sessions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("outcome", "transferred"),
      supabase
        .from("voice_frontdesk_sessions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("outcome", "callback_scheduled"),
    ]);
  const sessions = dbRows<{
    id: string;
    preferred_language: string | null;
    detected_intent: string | null;
    status: string;
    outcome: string | null;
    transfer_reason: string | null;
    summary: string | null;
    created_at: string;
    disposition: unknown;
  }>(sessionsRaw);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Voice Front Desk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Multilingual intake in front of human call center (Urdu-first, guarded Sindhi/Pashto).
        </p>
      </div>
      <FrontdeskClient
        openAiConfigured={isOpenAiConfigured()}
        voiceFrontdeskAiEnabled={tenantAi.voiceFrontdeskAi}
        initialSessions={sessions}
        stats={{
          total: total ?? 0,
          transferred: transferred ?? 0,
          resolvedWithoutTransfer: Math.max((total ?? 0) - (transferred ?? 0), 0),
          callbacks: callbacks ?? 0,
        }}
      />
    </div>
  );
}
