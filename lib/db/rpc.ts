import type { Pool } from "pg";

export async function runRpc(
  pool: Pool,
  fn: string,
  params: Record<string, unknown>
): Promise<{ data: unknown; error: { message: string } | null }> {
  try {
    if (fn === "match_knowledge_chunks") {
      // Mirrors `public.match_knowledge_chunks` (pgvector + optional article allowlist).
      const pArticleIds = (params.p_article_ids as string[] | null | undefined) ?? null;
      const res = await pool.query(
        `SELECT k.id AS chunk_id, k.content, k.source_kind, k.source_id,
          (1 - (k.embedding <=> $2::vector))::double precision AS similarity
         FROM knowledge_chunks k
         WHERE k.tenant_id = $1::uuid
           AND k.embedding IS NOT NULL
           AND (
             $4::uuid[] IS NULL
             OR (k.source_kind = 'article' AND k.source_id = ANY ($4::uuid[]))
           )
         ORDER BY k.embedding <=> $2::vector
         LIMIT $3::int`,
        [params.p_tenant_id, params.query_embedding, params.match_count, pArticleIds]
      );
      return { data: res.rows, error: null };
    }
    if (fn === "increment_knowledge_article_usage_counts") {
      await pool.query(`SELECT public.increment_knowledge_article_usage_counts($1::uuid, $2::uuid[])`, [
        params.p_tenant_id,
        params.p_article_ids,
      ]);
      return { data: null, error: null };
    }
    if (fn === "lookup_hiring_application") {
      const res = await pool.query(`SELECT lookup_hiring_application($1::text, $2::text, $3::uuid) AS r`, [
        params.p_tenant_slug,
        params.p_reference_code,
        params.p_secure_token,
      ]);
      return { data: res.rows[0]?.r ?? null, error: null };
    }
    return { data: null, error: { message: `Unknown RPC: ${fn}` } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: { message: msg } };
  }
}
