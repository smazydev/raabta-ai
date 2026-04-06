import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { Cable, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatYmd } from "@/lib/format-date";
import { deleteConnectorAction, upsertConnectorAction } from "./actions";

const TYPE_OPTIONS = [
  { value: "bank_core", label: "Core banking (CBS)" },
  { value: "card_rail", label: "Card processor / rail" },
  { value: "raast", label: "Raast / IPS" },
  { value: "telephony", label: "Telephony / CCaaS" },
  { value: "ats", label: "ATS / hiring system" },
  { value: "ticketing", label: "Ticketing / ITSM" },
  { value: "siem", label: "SIEM / audit sink" },
  { value: "custom_http", label: "Custom HTTP adapter" },
] as const;

export default async function IntegrationsPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId, role } = session;
  const { data: connectorsRaw } = await supabase
    .from("connectors")
    .select("id, connector_type, display_name, status, notes, last_checked_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("display_name", { ascending: true });
  const connectors = dbRows<{
    id: string;
    connector_type: string;
    display_name: string;
    status: string;
    notes: string | null;
    last_checked_at: string | null;
    updated_at: string | Date | null;
  }>(connectorsRaw);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Integration catalog</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          System-of-record bindings for this tenant: each connector is a governed slot that workflow runners, HTTP
          adapters, and observability hooks resolve at execution time. Register what you operate; implementation
          details live in runbooks and provider profiles.
        </p>
      </div>
      <Card className="border-border/80 bg-gradient-to-br from-card to-secondary/15">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-primary" />
            Infrastructure topology
          </CardTitle>
          <CardDescription>
            North–south ingress, control plane, and persistence. Align connector types with the systems that emit or
            consume tenant-scoped events.
          </CardDescription>
        </CardHeader>
        <CardContent className="font-mono text-xs leading-relaxed text-muted-foreground">
          <pre className="whitespace-pre-wrap rounded-lg border border-border/60 bg-secondary/25 p-4 text-[11px]">
            {`┌─ Your estate (CBS, CCaaS, BSP, SIEM, …)
│
│  HTTPS / webhooks / batch jobs
▼
┌──────────────────────────────┐     ┌─────────────────────┐
│  Edge: POST /api/v1/events/  │────►│  AuthN: tenant API  │
│        ingest                │     │  keys + scopes      │
└──────────────┬───────────────┘     └─────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Control plane (this app)    │  policies · KB · assistant · workflows
│  Next.js API + Postgres RLS  │
└──────────────┬───────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
  Connector slots   Adapter HTTP / workers
  (this page)         (BANK_ADAPTER_*, cron, queues)`}
          </pre>
          <p className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
            <Cable className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Orchestration code paths reference <code className="rounded bg-secondary/50 px-1">lib/orchestration</code>{" "}
              and workflow HTTP nodes; keep display names and statuses here aligned with change management.
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {connectors.length === 0 ? (
          <Card className="border-dashed border-border md:col-span-2">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No connectors yet. Admins can register slots below, or run <code className="text-xs">npm run db:seed</code>{" "}
              after the provider migration for demo rows.
            </CardContent>
          </Card>
        ) : (
          connectors.map((c) => (
            <Card key={c.id} className="border-border bg-card">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-semibold">{c.display_name}</CardTitle>
                  <CardDescription className="font-mono text-[10px]">{c.connector_type}</CardDescription>
                </div>
                <Badge
                  variant={
                    c.status === "connected"
                      ? "default"
                      : c.status === "error"
                        ? "destructive"
                        : "outline"
                  }
                  className="shrink-0 text-[10px] uppercase"
                >
                  {c.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {c.notes ? <p>{c.notes}</p> : <p className="italic">No notes</p>}
                <p className="text-[10px]">
                  Updated {formatYmd(c.updated_at)}
                </p>
                {role === "admin" && (
                  <form action={upsertConnectorAction} className="space-y-2 border-t border-border pt-3">
                    <input type="hidden" name="id" value={c.id as string} />
                    <input type="hidden" name="connector_type" value={c.connector_type as string} />
                    <Input name="display_name" defaultValue={c.display_name as string} className="h-9 text-xs" />
                    <select
                      name="status"
                      defaultValue={c.status as string}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {["disconnected", "sandbox", "connected", "error", "planned"].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <Input name="notes" placeholder="Notes" defaultValue={(c.notes as string) ?? ""} className="h-9 text-xs" />
                    <Button type="submit" size="sm" variant="secondary" className="rounded-lg">
                      Update
                    </Button>
                  </form>
                )}
                {role === "admin" && (
                  <form action={deleteConnectorAction}>
                    <input type="hidden" name="id" value={c.id as string} />
                    <Button type="submit" size="sm" variant="ghost" className="text-destructive">
                      Remove
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {role === "admin" && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">Register connector</CardTitle>
            <CardDescription>Creates a named slot for implementation / runbooks.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={upsertConnectorAction} className="grid max-w-md gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  name="connector_type"
                  required
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Display name</label>
                <Input name="display_name" required placeholder="e.g. Production CBS read replica" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <select name="status" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" defaultValue="sandbox">
                  {["disconnected", "sandbox", "connected", "error", "planned"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <Input name="notes" placeholder="Endpoint, owner team, VPN, etc." />
              <Button type="submit" className="w-fit rounded-xl">
                Add connector
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
