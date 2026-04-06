import Link from "next/link";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { Bot, Mic, PhoneCall, Plus, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { formatYmd } from "@/lib/format-date";

type SearchParams = Promise<{
  q?: string;
  status?: string;
  kind?: string;
  dept?: string;
}>;

function KindIcon({ kind }: { kind: string }) {
  if (kind === "voice") return <Mic className="h-4 w-4 shrink-0 text-primary" />;
  if (kind === "both") return <PhoneCall className="h-4 w-4 shrink-0 text-primary" />;
  return <Bot className="h-4 w-4 shrink-0 text-primary" />;
}

export default async function AgentsListPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";
  const statusF = sp.status?.trim() ?? "";
  const kindF = sp.kind?.trim() ?? "";
  const deptF = sp.dept?.trim() ?? "";

  const { supabase, tenantId } = session;
  let query = supabase
    .from("ai_agents")
    .select(
      "id, name, slug, kind, description, updated_at, status, department"
    )
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (statusF === "draft" || statusF === "live" || statusF === "archived") {
    query = query.eq("status", statusF);
  }
  if (kindF === "chat" || kindF === "voice" || kindF === "both") {
    query = query.eq("kind", kindF);
  }
  if (deptF === "HR" || deptF === "IT" || deptF === "Operations" || deptF === "Compliance" || deptF === "Support") {
    query = query.eq("department", deptF);
  }

  const { data: agentsRaw } = await query;
  let agents = dbRows<{
    id: string;
    name: string;
    slug: string;
    kind: string;
    description: string | null;
    updated_at: string | Date | null;
    status: string | null;
    department: string | null;
  }>(agentsRaw);

  if (q) {
    agents = agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q)
    );
  }

  const buildHref = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, status: sp.status, kind: sp.kind, dept: sp.dept, ...next };
    if (merged.q) p.set("q", merged.q);
    if (merged.status) p.set("status", merged.status);
    if (merged.kind) p.set("kind", merged.kind);
    if (merged.dept) p.set("dept", merged.dept);
    const s = p.toString();
    return s ? `/platform/agents?${s}` : "/platform/agents";
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Agent studio</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Enterprise configuration for governed AI agents: channel coverage, knowledge orchestration, workflow
            automation, and human handoff. Assign live agents in{" "}
            <Link href="/conversations" className="font-medium text-primary hover:underline">
              Conversations
            </Link>
            .
          </p>
        </div>
        <Link href="/platform/agents/new" className={cn(buttonVariants(), "rounded-xl no-underline")}>
          <Plus className="mr-2 h-4 w-4" />
          New agent
        </Link>
      </div>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Catalog filters</CardTitle>
          <CardDescription>Search and slice the tenant agent registry.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end" action="/platform/agents" method="get">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input name="q" placeholder="Search name, slug, description…" defaultValue={sp.q ?? ""} className="pl-9" />
            </div>
            <select
              name="status"
              className="h-10 rounded-md border border-input bg-background px-2 text-sm lg:w-40"
              defaultValue={statusF}
            >
              <option value="">All statuses</option>
              <option value="live">Live</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <select
              name="kind"
              className="h-10 rounded-md border border-input bg-background px-2 text-sm lg:w-44"
              defaultValue={kindF}
            >
              <option value="">All channels</option>
              <option value="chat">Chat</option>
              <option value="voice">Voice</option>
              <option value="both">Chat &amp; voice</option>
            </select>
            <select
              name="dept"
              className="h-10 rounded-md border border-input bg-background px-2 text-sm lg:w-48"
              defaultValue={deptF}
            >
              <option value="">All departments</option>
              <option value="HR">HR</option>
              <option value="IT">IT</option>
              <option value="Operations">Operations</option>
              <option value="Compliance">Compliance</option>
              <option value="Support">Support</option>
            </select>
            <button type="submit" className={cn(buttonVariants({ variant: "secondary" }), "rounded-xl")}>
              Apply
            </button>
            <Link href="/platform/agents" className={cn(buttonVariants({ variant: "ghost" }), "no-underline")}>
              Reset
            </Link>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="text-muted-foreground">Quick:</span>
            <Link href={buildHref({ status: "live", kind: undefined, dept: undefined })} className="text-primary hover:underline">
              Live only
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href={buildHref({ dept: "HR", status: undefined })} className="text-primary hover:underline">
              HR
            </Link>
            <Link href={buildHref({ dept: "IT", status: undefined })} className="text-primary hover:underline">
              IT
            </Link>
            <Link href={buildHref({ dept: "Compliance", status: undefined })} className="text-primary hover:underline">
              Compliance
            </Link>
          </div>
        </CardContent>
      </Card>

      {agents.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardHeader>
            <CardTitle className="text-base">No matching agents</CardTitle>
            <CardDescription>
              Adjust filters or create a governed agent for chat, voice, or both surfaces.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/platform/agents/new" className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}>
              Create agent
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Link key={a.id} href={`/platform/agents/${a.id}`} className="group block">
              <Card className="h-full border-border transition-colors group-hover:border-primary/30 group-hover:bg-secondary/10">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <KindIcon kind={a.kind} />
                      <span className="truncate">{a.name}</span>
                    </CardTitle>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge
                        variant={a.status === "live" ? "default" : a.status === "archived" ? "secondary" : "outline"}
                        className="text-[10px] uppercase"
                      >
                        {a.status ?? "draft"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {a.kind === "both" ? "chat+voice" : a.kind}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="font-mono text-[10px]">{a.slug}</CardDescription>
                  {a.department ? (
                    <p className="text-[10px] font-medium text-muted-foreground">{a.department}</p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {a.description || "No description — open agent to configure instructions and sources."}
                  </p>
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    Updated {formatYmd(a.updated_at)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <Link href="/platform" className="text-primary hover:underline">
          ← AI control plane
        </Link>
      </p>
    </div>
  );
}
