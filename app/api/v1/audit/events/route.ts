import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { dbRows } from "@/lib/db/rows";
import { resolveBearerApiKey, scopeAllows } from "@/lib/platform/api-key";

export const runtime = "nodejs";

/** Paginated audit log export. Scope: audit:read */
export async function GET(req: Request) {
  const resolved = await resolveBearerApiKey(req.headers.get("authorization"));
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scopeAllows(resolved.scopes, "audit:read")) {
    return NextResponse.json({ error: "Missing scope: audit:read" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const cursor = url.searchParams.get("cursor");

  const admin = createServiceRoleClient();
  let q = admin
    .from("audit_events")
    .select("id, source, actor_label, action, resource_type, resource_id, payload, created_at")
    .eq("tenant_id", resolved.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    q = q.lt("created_at", cursor);
  }

  const { data: rowsRaw, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = dbRows<Record<string, unknown> & { created_at: string }>(rowsRaw);
  const list = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit
      ? (typeof list[list.length - 1]?.created_at === "string"
          ? list[list.length - 1]!.created_at
          : undefined)
      : undefined;

  return NextResponse.json({
    events: list,
    next_cursor: nextCursor ?? null,
  });
}
