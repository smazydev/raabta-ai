import type { AppDbClient } from "@/lib/db/types";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { dbRows } from "@/lib/db/rows";
import { embedTextsWithUsage, vectorToPgLiteral } from "./embeddings";
import { chargeAfterEmbeddingCall } from "@/lib/billing/credits";
import {
  enrichKnowledgeEmbeddingQuery,
  escapeForIlikeToken,
  knowledgeTextSearchTokens,
} from "./query-expand";

export type ArticleSnippet = {
  id: string;
  title: string;
  body: string;
  tags: string[];
};

export type SearchKnowledgeOptions = {
  /**
   * When set: only these article IDs are considered.
   * - Omitted / undefined: entire tenant corpus (default).
   * - Empty array: no articles allowed (returns []).
   */
  allowedArticleIds?: string[];
};

type ChunkMatch = {
  chunk_id: string;
  content: string;
  source_kind: string;
  source_id: string;
  similarity: number;
};

/** After a search returns articles, bump `knowledge_articles.usage_count` (Retrieval hits in UI). */
async function recordKnowledgeRetrievalHits(
  supabase: AppDbClient,
  tenantId: string,
  snippets: ArticleSnippet[]
): Promise<void> {
  const ids = [...new Set(snippets.map((s) => s.id).filter(Boolean))];
  if (ids.length === 0) return;
  const { error } = await supabase.rpc("increment_knowledge_article_usage_counts", {
    p_tenant_id: tenantId,
    p_article_ids: ids,
  });
  if (error) {
    console.warn("[knowledge] increment usage_count:", error.message);
  }
}

/** Substring / token ILIKE search — used only when tenant has embeddings disabled. */
export async function searchKnowledgeText(
  supabase: AppDbClient,
  tenantId: string,
  query: string,
  limit = 5,
  options?: SearchKnowledgeOptions
): Promise<ArticleSnippet[]> {
  const q = query.trim();
  if (!q) return [];

  const filter = options?.allowedArticleIds;
  if (filter !== undefined && filter.length === 0) return [];

  const runSelect = (orClause: string) => {
    let artQuery = supabase
      .from("knowledge_articles")
      .select("id, title, body, tags")
      .eq("tenant_id", tenantId)
      .or(orClause)
      .limit(limit);

    if (filter !== undefined && filter.length > 0) {
      artQuery = artQuery.in("id", filter);
    }
    return artQuery;
  };

  const mapRows = (data: unknown) => {
    const rows = dbRows<{ id: string; title: string; body: string; tags: unknown }>(data);
    return rows.map((r) => ({
      ...r,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    }));
  };

  const safeFull = q.replace(/%/g, "").replace(/_/g, "");
  let { data, error } = await runSelect(`title.ilike.%${safeFull}%,body.ilike.%${safeFull}%`);

  if (error) throw error;
  let snippets = mapRows(data);
  if (snippets.length > 0) return snippets;

  const toks = knowledgeTextSearchTokens(q);
  if (toks.length === 0) return [];

  const parts: string[] = [];
  for (const t of toks.slice(0, 8)) {
    const s = escapeForIlikeToken(t);
    if (!s) continue;
    parts.push(`title.ilike.%${s}%`, `body.ilike.%${s}%`);
  }
  if (parts.length === 0) return [];

  ({ data, error } = await runSelect(parts.join(",")));
  if (error) throw error;
  snippets = mapRows(data);
  return snippets;
}

/**
 * Semantic search via PostgreSQL pgvector (`match_knowledge_chunks` on `knowledge_chunks`).
 * When tenant embeddings are enabled: **vector-only** (no ILIKE fallback). Empty result means
 * no indexed chunks matched — re-save articles or run KB reindex so chunks exist.
 * When embeddings are disabled in tenant settings: substring `searchKnowledgeText` only.
 */
export async function searchKnowledge(
  supabase: AppDbClient,
  tenantId: string,
  query: string,
  limit = 5,
  options?: SearchKnowledgeOptions
): Promise<ArticleSnippet[]> {
  const q = query.trim();
  if (!q) return [];

  const filter = options?.allowedArticleIds;
  if (filter !== undefined && filter.length === 0) {
    return [];
  }

  const pArticleIds: string[] | null =
    filter !== undefined && filter.length > 0 ? filter : null;

  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.embeddingsEnabled) {
    const textHits = await searchKnowledgeText(supabase, tenantId, q, limit, options);
    await recordKnowledgeRetrievalHits(supabase, tenantId, textHits);
    return textHits;
  }

  const matchCount = Math.min(200, Math.max(limit * 6, 24));

  try {
    const embedText = enrichKnowledgeEmbeddingQuery(q);
    const { vectors, usage } = await embedTextsWithUsage([embedText]);
    const qVec = vectors[0];
    if (!qVec) return [];
    await chargeAfterEmbeddingCall(tenantId, usage, "openai.embeddings.query", { query_chars: q.length });

    const { data: matches, error: rpcError } = await supabase.rpc("match_knowledge_chunks", {
      p_tenant_id: tenantId,
      query_embedding: vectorToPgLiteral(qVec),
      match_count: matchCount,
      p_article_ids: pArticleIds,
    });

    if (rpcError) {
      console.warn("[searchKnowledge] match_knowledge_chunks:", rpcError.message);
      return [];
    }

    const chunkList = Array.isArray(matches) ? (matches as ChunkMatch[]) : [];
    if (chunkList.length === 0) {
      return [];
    }

    const articleIds = [
      ...new Set(chunkList.filter((m) => m.source_kind === "article").map((m) => m.source_id)),
    ];
    if (articleIds.length === 0) {
      return [];
    }

    const { data: articles, error: artError } = await supabase
      .from("knowledge_articles")
      .select("id, title, body, tags")
      .eq("tenant_id", tenantId)
      .in("id", articleIds);

    if (artError) {
      console.warn("[searchKnowledge] knowledge_articles:", artError.message);
      return [];
    }

    const artRows = dbRows<{ id: string; title: string; body: string; tags: unknown }>(articles);
    const byId = new Map(
      artRows.map((a) => [
        a.id,
        { ...a, tags: Array.isArray(a.tags) ? (a.tags as string[]) : [] } satisfies ArticleSnippet,
      ])
    );
    const bestSim = new Map<string, number>();
    for (const m of chunkList) {
      if (m.source_kind !== "article") continue;
      const prev = bestSim.get(m.source_id) ?? 0;
      if (m.similarity > prev) bestSim.set(m.source_id, m.similarity);
    }

    const ranked = articleIds
      .map((id) => ({ id, sim: bestSim.get(id) ?? 0 }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit)
      .map((x) => byId.get(x.id))
      .filter(Boolean) as ArticleSnippet[];

    await recordKnowledgeRetrievalHits(supabase, tenantId, ranked);
    return ranked;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[searchKnowledge] vector path failed:", msg);
    return [];
  }
}
