import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createWorkflowAndRedirect } from "./actions";
import { formatYmdHm } from "@/lib/format-date";
import { GitBranch, Radio, Workflow } from "lucide-react";

function categoryLabel(raw: string | null | undefined): string {
  if (raw?.trim()) return raw.trim();
  return "General automation";
}

export default async function WorkflowsPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId, role } = session;
  const isAdmin = role === "admin";

  const { data: workflowsRaw } = await supabase
    .from("workflows")
    .select(
      "id, name, description, enabled, trigger_type, channels, sort_order, updated_at, category, last_run_at, run_count"
    )
    .eq("tenant_id", tenantId as string)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const workflows = dbRows<{
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    trigger_type: string;
    channels: unknown;
    sort_order: number;
    updated_at: string | Date | null;
    category: string | null;
    last_run_at: string | Date | null;
    run_count: number | null;
  }>(workflowsRaw);

  const { error: workflowsError } = await supabase.from("workflows").select("id").eq("tenant_id", tenantId as string).limit(1);
  const missingWorkflowTables =
    workflowsError?.code === "42P01" || workflowsError?.code === "PGRST205";

  const { data: linksRaw } = await supabase
    .from("ai_agent_workflow_allowlist")
    .select("workflow_id, agent_id")
    .eq("tenant_id", tenantId);
  const wfLinks = dbRows<{ workflow_id: string; agent_id: string }>(linksRaw);
  const { data: agentNamesRaw } = await supabase.from("ai_agents").select("id, name").eq("tenant_id", tenantId);
  const agentNames = dbRows<{ id: string; name: string }>(agentNamesRaw);
  const aname = new Map(agentNames.map((a) => [a.id, a.name]));
  const agentsByWf = new Map<string, string[]>();
  for (const l of wfLinks) {
    const n = aname.get(l.agent_id);
    if (!n) continue;
    const list = agentsByWf.get(l.workflow_id) ?? [];
    list.push(n);
    agentsByWf.set(l.workflow_id, list);
  }

  const byCategory = new Map<string, typeof workflows>();
  for (const w of workflows) {
    const key = categoryLabel(w.category);
    const list = byCategory.get(key) ?? [];
    list.push(w);
    byCategory.set(key, list);
  }
  const categoryOrder = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Workflow automation</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Conversation → action: linear orchestration with internal steps and HTTP calls to your controlled adapters.
            Operators run manual flows from{" "}
            <Link href="/conversations" className="font-medium text-primary hover:underline">
              Conversations
            </Link>{" "}
            and voice surfaces; intent-matched flows surface as suggested actions.
          </p>
        </div>
        {isAdmin && !missingWorkflowTables && (
          <form action={createWorkflowAndRedirect}>
            <Button type="submit" size="sm" className="rounded-xl">
              New workflow
            </Button>
          </form>
        )}
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4 text-primary" />
            Catalog
          </CardTitle>
          <CardDescription>
            Categories group service-desk style automations. Linked agents show where each flow is allowlisted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {missingWorkflowTables ? (
            <p className="text-sm text-amber-600 dark:text-amber-300">
              Workflow tables are missing. Apply <code className="text-xs">20250330130000_workflows.sql</code> then
              refresh.
            </p>
          ) : workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No workflows yet. {isAdmin ? "Create one to connect conversations to backend work." : "Ask an admin."}
            </p>
          ) : (
            categoryOrder.map((cat) => (
              <div key={cat}>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  {cat}
                </h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(byCategory.get(cat) ?? []).map((w) => {
                    const chans = (Array.isArray(w.channels) ? w.channels : []) as string[];
                    const linked = agentsByWf.get(w.id) ?? [];
                    return (
                      <Link key={w.id} href={`/workflows/${w.id}`} className="group block">
                        <Card className="h-full border-border transition-colors group-hover:border-primary/35 group-hover:bg-secondary/15">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <CardTitle className="text-base leading-snug">{w.name}</CardTitle>
                              <Badge variant={w.enabled ? "default" : "secondary"} className="shrink-0 text-[10px]">
                                {w.enabled ? "enabled" : "disabled"}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {w.trigger_type.replace("_", " ")}
                              </Badge>
                              {chans.slice(0, 3).map((c) => (
                                <Badge key={c} variant="outline" className="text-[10px] font-normal">
                                  {c.replace("_", " ")}
                                </Badge>
                              ))}
                              {chans.length > 3 ? (
                                <Badge variant="outline" className="text-[10px]">
                                  +{chans.length - 3}
                                </Badge>
                              ) : null}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3 text-xs text-muted-foreground">
                            {w.description ? <p className="line-clamp-2 text-sm">{w.description}</p> : null}
                            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-secondary/20 p-2 font-mono">
                              <div>
                                <p className="text-[10px] uppercase text-muted-foreground">Runs (seed)</p>
                                <p className="text-sm font-bold text-foreground">{w.run_count ?? 0}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase text-muted-foreground">Last run</p>
                                <p className="text-[10px] font-bold text-foreground">
                                  {formatYmdHm(w.last_run_at)}
                                </p>
                              </div>
                            </div>
                            <div>
                              <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
                                <Radio className="h-3 w-3" />
                                Linked agents
                              </p>
                              <p className="mt-1 text-xs text-foreground">
                                {linked.length ? linked.join(", ") : "— link agents in your governed-agent config"}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
