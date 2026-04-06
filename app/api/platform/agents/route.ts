import { NextResponse } from "next/server";
import { dbRows } from "@/lib/db/rows";
import { getSessionTenantForApi } from "@/lib/session";

export const runtime = "nodejs";

/** Tenant-scoped agent catalog for integrations / tooling (cookie session). */
export async function GET() {
  const session = await getSessionTenantForApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { supabase, tenantId } = session;
  const { data: raw, error } = await supabase
    .from("ai_agents")
    .select("id, name, slug, kind, status, department, description, updated_at")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const agents = dbRows<{
    id: string;
    name: string;
    slug: string;
    kind: string;
    status: string | null;
    department: string | null;
    description: string | null;
    updated_at: string;
  }>(raw);

  return NextResponse.json({ agents });
}
