import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { dbRows } from "@/lib/db/rows";
import { resolveBearerApiKey, scopeAllows } from "@/lib/platform/api-key";

export const runtime = "nodejs";

/** Aggregated usage for metering / billing hooks. Scope: metrics:read */
export async function GET(req: Request) {
  const resolved = await resolveBearerApiKey(req.headers.get("authorization"));
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scopeAllows(resolved.scopes, "metrics:read")) {
    return NextResponse.json({ error: "Missing scope: metrics:read" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromIso = from ? new Date(from).toISOString() : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const toIso = to ? new Date(to).toISOString() : new Date().toISOString();

  const admin = createServiceRoleClient();
  const { data: rowsRaw, error } = await admin
    .from("usage_events")
    .select("event_type, quantity, unit, created_at")
    .eq("tenant_id", resolved.tenantId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = dbRows<{ event_type: string; quantity: unknown; unit: unknown; created_at: string }>(rowsRaw);
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const t = r.event_type;
    const q = Number(r.quantity ?? 0);
    byType[t] = (byType[t] ?? 0) + q;
  }

  return NextResponse.json({
    tenant_id: resolved.tenantId,
    from: fromIso,
    to: toIso,
    totals_by_type: byType,
    sample: rows.slice(0, 100),
  });
}
