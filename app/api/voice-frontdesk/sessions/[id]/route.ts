import { NextResponse } from "next/server";
import { getSessionTenantForApi } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { VOICE_CALLING_ENABLED } from "@/lib/features";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  if (!VOICE_CALLING_ENABLED) {
    return NextResponse.json({ error: "Voice calling is disabled." }, { status: 410 });
  }
  const session = await getSessionTenantForApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { supabase, tenantId } = session;
  const { id } = await context.params;

  const [{ data: row }, { data: turnsRaw }, { data: requestsRaw }] = await Promise.all([
    supabase
      .from("voice_frontdesk_sessions")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single(),
    supabase
      .from("voice_frontdesk_turns")
      .select("id, actor, language, text, redacted_text, confidence, created_at")
      .eq("session_id", id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("frontdesk_requests")
      .select("id, request_type, external_ref, payload, status, created_at")
      .eq("session_id", id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  ]);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const turns = dbRows<Record<string, unknown>>(turnsRaw);
  const requests = dbRows<Record<string, unknown>>(requestsRaw);
  return NextResponse.json({
    session: row,
    turns,
    requests,
  });
}
