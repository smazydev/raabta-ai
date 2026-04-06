-- Bump per-article retrieval counters (shown as "Retrieval hits" on Knowledge UI).
-- Called from app after vector/text search returns articles. Caller supplies tenant + IDs (trust session).

CREATE OR REPLACE FUNCTION public.increment_knowledge_article_usage_counts(
  p_tenant_id uuid,
  p_article_ids uuid[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.knowledge_articles k
  SET usage_count = k.usage_count + 1
  WHERE k.tenant_id = p_tenant_id
    AND k.id = ANY (p_article_ids);
$$;

REVOKE ALL ON FUNCTION public.increment_knowledge_article_usage_counts(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_knowledge_article_usage_counts(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_knowledge_article_usage_counts(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_knowledge_article_usage_counts(uuid, uuid[]) TO postgres;
