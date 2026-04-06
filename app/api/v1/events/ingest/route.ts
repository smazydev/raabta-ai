import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { resolveBearerApiKey, scopeAllows } from "@/lib/platform/api-key";
import { enqueueLiveEventWebhook } from "@/lib/platform/live-events-webhook";
import { recordAuditEvent, recordUsageEvent } from "@/lib/platform/telemetry";

export const runtime = "nodejs";

/**
 * Ingress: external systems post normalized events into live_events + audit.
 * Auth: Bearer rk_live_… with scope `events:write`
 */
export async function POST(req: Request) {
  const resolved = await resolveBearerApiKey(req.headers.get("authorization"));
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scopeAllows(resolved.scopes, "events:write")) {
    return NextResponse.json({ error: "Missing scope: events:write" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    event_type?: string;
    payload?: Record<string, unknown>;
  } | null;
  const eventType = String(body?.event_type ?? "").trim();
  if (!eventType || eventType.length > 200) {
    return NextResponse.json({ error: "event_type required (max 200 chars)" }, { status: 400 });
  }
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

  const admin = createServiceRoleClient();
  const { data: row, error } = await admin
    .from("live_events")
    .insert({
      tenant_id: resolved.tenantId,
      event_type: eventType,
      payload,
    })
    .select("id, created_at")
    .single();

  if (error || !row || typeof row.id !== "string") {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  const createdAt =
    typeof (row as { created_at?: string }).created_at === "string"
      ? (row as { created_at: string }).created_at
      : new Date().toISOString();
  enqueueLiveEventWebhook({
    tenant_id: resolved.tenantId,
    live_event_id: row.id,
    event_type: eventType,
    payload,
    created_at: createdAt,
  });

  await recordUsageEvent({
    tenantId: resolved.tenantId,
    eventType: "api.v1.events.ingest",
    metadata: { event_type: eventType },
  });
  await recordAuditEvent({
    tenantId: resolved.tenantId,
    source: "api",
    action: "events.ingest",
    actorLabel: `api_key:${resolved.keyId.slice(0, 8)}`,
    resourceType: "live_event",
    resourceId: row.id,
    payload: { event_type: eventType },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
