import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { ComplaintsTable } from "./complaints-table";
import { Badge } from "@/components/ui/badge";

export default async function ComplaintsPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;

  const { data: tenantRow } = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  const tenantLabel =
    typeof tenantRow?.name === "string" && tenantRow.name.trim() ? tenantRow.name.trim() : "This tenant";

  const { data: complaintsRaw } = await supabase
    .from("complaints")
    .select(
      "id, customer_id, reference, category, priority, status, summary, sla_due_at, assigned_team, conversation_id, call_id, created_at"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  const list = dbRows<{
    id: string;
    customer_id: string;
    reference: string;
    category: string;
    priority: string;
    status: string;
    summary: string | null;
    sla_due_at: string | null;
    assigned_team: string | null;
    conversation_id: string | null;
    call_id: string | null;
    created_at: string;
  }>(complaintsRaw);
  const cids = [...new Set(list.map((c) => c.customer_id))];
  let custRows: { id: string; full_name: string; account_number: string | null }[] = [];
  if (cids.length) {
    const { data: custRaw } = await supabase
      .from("customers")
      .select("id, full_name, account_number")
      .in("id", cids);
    custRows = dbRows<{ id: string; full_name: string; account_number: string | null }>(custRaw);
  }
  const cmap = new Map(custRows.map((c) => [c.id, c]));
  const rows = list.map((c) => ({
    ...c,
    customer: cmap.get(c.customer_id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Complaints</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Case management with SLA tags and linkage to conversations / calls.
          </p>
        </div>
        <Badge variant="outline" className="max-w-[min(100%,16rem)] truncate border-border font-normal text-muted-foreground">
          {tenantLabel}
        </Badge>
      </div>
      <ComplaintsTable rows={rows} />
    </div>
  );
}
