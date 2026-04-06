import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import KnowledgeSearch from "./search";
import { AddArticleDialog } from "./add-article-dialog";
import { reindexAllKnowledgeArticlesAction } from "./actions";
import { formatYmd } from "@/lib/format-date";
import { BookMarked, Shield } from "lucide-react";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId, role } = session;
  const tenantAi = await getTenantAiSettings(supabase, tenantId);
  const q = (await searchParams).q?.trim() ?? "";

  let query = supabase
    .from("knowledge_articles")
    .select(
      "id, title, body, tags, usage_count, updated_at, source, department_team, access_scope, readiness"
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (q) {
    query = query.or(`title.ilike.%${q}%,body.ilike.%${q}%`);
  }

  const { data: articlesRaw } = await query.limit(80);
  const articles = dbRows<{
    id: string;
    title: string;
    body: string;
    tags: unknown;
    usage_count: number;
    updated_at: string;
    source: string | null;
    department_team: string | null;
    access_scope: string | null;
    readiness: string | null;
  }>(articlesRaw);

  const { data: linksRaw } = await supabase
    .from("ai_agent_knowledge_articles")
    .select("article_id, agent_id")
    .eq("tenant_id", tenantId);
  const links = dbRows<{ article_id: string; agent_id: string }>(linksRaw);

  const { data: kbForDialogRaw } = await supabase
    .from("knowledge_bases")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  const knowledgeBasesForDialog = dbRows<{ id: string; name: string }>(kbForDialogRaw);

  const { data: agentsRaw } = await supabase.from("ai_agents").select("id, name").eq("tenant_id", tenantId);
  const agents = dbRows<{ id: string; name: string }>(agentsRaw);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  const usedBy = new Map<string, string[]>();
  for (const l of links) {
    const name = agentName.get(l.agent_id);
    if (!name) continue;
    const list = usedBy.get(l.article_id) ?? [];
    list.push(name);
    usedBy.set(l.article_id, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Knowledge orchestration</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Governed internal corpus for policy-grounded responses — not model memory. Articles are tenant-scoped,
            tagged for teams, grouped into{" "}
            <Link href="/knowledge/bases" className="font-medium text-primary hover:underline">
              knowledge bases
            </Link>
            , and attachable to governed agents (e.g. voice agent in Settings, conversation assignment). Saving
            articles triggers embedding jobs (OpenAI); chat model defaults live in{" "}
            <Link href="/settings" className="font-medium text-primary hover:underline">
              Settings
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddArticleDialog knowledgeBases={knowledgeBasesForDialog} />
          {role === "admin" && (
            <form action={reindexAllKnowledgeArticlesAction}>
              <Button
                type="submit"
                variant="outline"
                className="rounded-xl text-xs font-semibold"
                disabled={!tenantAi.embeddingsEnabled}
                title={
                  tenantAi.embeddingsEnabled
                    ? undefined
                    : "Enable Knowledge embeddings in Settings → AI automation"
                }
              >
                Rebuild embeddings
              </Button>
            </form>
          )}
        </div>
      </div>

      <Card className="border-primary/15 bg-primary/[0.03]">
        <CardContent className="flex flex-wrap items-start gap-3 py-4 text-sm">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-foreground">Controlled retrieval</p>
            <p className="mt-1 text-muted-foreground">
              Each document carries access scope and readiness. In production, wire approval workflows and SIEM export
              from the integration catalog for full auditability.
            </p>
          </div>
        </CardContent>
      </Card>

      <KnowledgeSearch initialQ={q} />
      <div className="grid gap-4 md:grid-cols-2">
        {articles.length === 0 ? (
          <Card className="border-dashed border-border md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">No articles</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Seed the tenant or add SOPs and policy excerpts. Use tags and department fields so agents only pull
              approved sources.
            </CardContent>
          </Card>
        ) : (
          articles.map((a) => {
            const names = usedBy.get(a.id) ?? [];
            const readiness = a.readiness ?? "indexed";
            return (
              <Card key={a.id} className="border-border bg-card">
                <CardHeader className="space-y-2 pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{a.title}</CardTitle>
                    <Badge
                      variant={readiness === "indexed" ? "default" : "secondary"}
                      className="shrink-0 text-[10px] uppercase"
                    >
                      {readiness}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {a.source ?? "internal"}
                    </Badge>
                    {a.department_team ? (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {a.department_team}
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="text-[10px] font-normal">
                      scope: {a.access_scope ?? "tenant"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p className="line-clamp-3 text-foreground/90">{a.body}</p>
                  <div className="flex flex-wrap gap-1">
                    {(Array.isArray(a.tags) ? a.tags : []).map((t: string) => (
                      <Badge key={t} variant="outline" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs">
                    <span className="text-muted-foreground">Retrieval hits: {a.usage_count}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Updated {formatYmd(a.updated_at)}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <BookMarked className="h-3 w-3" />
                      Used by agents
                    </p>
                    {names.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">Not linked to any governed agent.</p>
                    ) : (
                      <p className="mt-1 text-xs text-foreground">{names.join(", ")}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
