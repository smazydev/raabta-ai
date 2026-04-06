import type { AppDbClient } from "@/lib/db/types";
import { dbRows } from "@/lib/db/rows";

/**
 * Resolves which knowledge articles a voice (or other) agent may retrieve.
 *
 * - `undefined` → search the full tenant knowledge corpus (legacy default).
 * - `[]` → agent has governance links but no articles resolved yet (no hits).
 * - non-empty → union of articles in assigned knowledge bases + direct article links.
 */
export async function resolveAgentKnowledgeArticleFilter(
  supabase: AppDbClient,
  tenantId: string,
  agentId: string | null
): Promise<string[] | undefined> {
  if (!agentId) return undefined;

  const [kbRes, artRes] = await Promise.all([
    supabase
      .from("ai_agent_knowledge_bases")
      .select("knowledge_base_id")
      .eq("agent_id", agentId)
      .eq("tenant_id", tenantId),
    supabase
      .from("ai_agent_knowledge_articles")
      .select("article_id")
      .eq("agent_id", agentId)
      .eq("tenant_id", tenantId),
  ]);

  const kbLinks = dbRows<{ knowledge_base_id: string }>(kbRes.data);
  const artLinks = dbRows<{ article_id: string }>(artRes.data);

  const hasGovernance = kbLinks.length > 0 || artLinks.length > 0;
  if (!hasGovernance) return undefined;

  const ids = new Set<string>();
  for (const r of artLinks) ids.add(r.article_id);

  if (kbLinks.length > 0) {
    const kbIds = kbLinks.map((r) => r.knowledge_base_id);
    const { data: fromKb } = await supabase
      .from("knowledge_articles")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("knowledge_base_id", kbIds);
    for (const r of dbRows<{ id: string }>(fromKb)) ids.add(r.id);
  }

  return [...ids];
}
