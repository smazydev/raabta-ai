import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createHiringApplicationAction } from "./actions";

export default async function HrPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId, role } = session;

  const { data: tenant } = await supabase.from("tenants").select("slug, name").eq("id", tenantId).single();

  const { data: hiringRaw } = await supabase
    .from("hiring_applications")
    .select("id, reference_code, secure_token, candidate_name, stage, document_discrepancy, offer_issued, updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  const hiring = dbRows<{
    id: string;
    reference_code: string;
    secure_token: string;
    candidate_name: string;
    stage: string;
    document_discrepancy: string | null;
    offer_issued: boolean;
    updated_at: string;
  }>(hiringRaw);

  const { data: profilesRaw } = await supabase
    .from("profiles")
    .select("id, display_name, role")
    .eq("tenant_id", tenantId)
    .order("display_name", { ascending: true });
  const profiles = dbRows<{ id: string; display_name: string | null; role: string }>(profilesRaw);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight">HR & hiring</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage hiring records (staff). Candidates check status on{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-xs">/hiring-status</code> with reference + secure token.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Tenant slug (for public lookup):{" "}
          <Badge variant="outline">{typeof tenant?.slug === "string" ? tenant.slug : "—"}</Badge>
        </p>
      </div>

      {role === "admin" && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">New hiring application</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createHiringApplicationAction} className="grid max-w-xl gap-3">
              <div className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="reference_code">
                  Reference code
                </label>
                <Input id="reference_code" name="reference_code" required placeholder="e.g. ACME-2026-0042" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="candidate_name">
                  Candidate name
                </label>
                <Input id="candidate_name" name="candidate_name" required />
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="candidate_email">
                  Email (optional)
                </label>
                <Input id="candidate_email" name="candidate_email" type="email" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="stage">
                  Stage
                </label>
                <Input id="stage" name="stage" defaultValue="applied" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="document_discrepancy">
                  Document note (optional)
                </label>
                <Input id="document_discrepancy" name="document_discrepancy" placeholder="e.g. Missing back of CNIC" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="offer_issued" className="rounded border-input" />
                Offer issued
              </label>
              <Button type="submit" className="w-fit rounded-xl">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Applications</CardTitle>
          <p className="text-xs text-muted-foreground">
            Share <strong>reference code</strong> + <strong>secure token</strong> with the candidate (e.g. in email). Treat
            the token like a password.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {hiring.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications yet.</p>
          ) : (
            <ul className="space-y-3">
              {hiring.map((h) => (
                <li
                  key={h.id}
                  className="rounded-xl border border-border bg-secondary/20 p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{h.candidate_name}</span>
                    <Badge variant="outline">{h.stage}</Badge>
                  </div>
                  <div className="mt-2 grid gap-1 font-mono text-xs text-muted-foreground">
                    <span>
                      ref: <span className="text-foreground">{h.reference_code}</span>
                    </span>
                    <span>
                      token: <span className="break-all text-foreground">{h.secure_token}</span>
                    </span>
                  </div>
                  {h.document_discrepancy ? (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Docs: {h.document_discrepancy}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs">Offer issued: {h.offer_issued ? "yes" : "no"}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Profiles (survey assignee IDs)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Admins: use these UUIDs with the assistant tool <code>assign_survey</code>.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {profiles.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <span>{p.display_name ?? "—"}</span>
                <Badge variant="secondary">{p.role}</Badge>
                <code className="w-full break-all text-[10px] text-muted-foreground md:w-auto">{p.id}</code>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
