-- Named knowledge bases per tenant; articles can belong to one base.
-- Agents (including voice) can be assigned multiple bases + legacy per-article links.
-- Vector search can filter to allowed article IDs for governed retrieval.

CREATE TABLE IF NOT EXISTS public.knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS knowledge_bases_tenant_idx ON public.knowledge_bases (tenant_id);

ALTER TABLE public.knowledge_articles
  ADD COLUMN IF NOT EXISTS knowledge_base_id uuid REFERENCES public.knowledge_bases (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS knowledge_articles_base_idx
  ON public.knowledge_articles (tenant_id, knowledge_base_id)
  WHERE knowledge_base_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_agent_knowledge_bases (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents (id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, knowledge_base_id)
);

CREATE INDEX IF NOT EXISTS ai_agent_kb_tenant_idx ON public.ai_agent_knowledge_bases (tenant_id);

ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_knowledge_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_bases_all ON public.knowledge_bases
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY ai_agent_kb_all ON public.ai_agent_knowledge_bases
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Replace chunk matcher: optional article allowlist (NULL = entire tenant corpus for articles)
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(uuid, vector, int);

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_tenant_id uuid,
  query_embedding vector(1536),
  match_count int DEFAULT 8,
  p_article_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  content text,
  source_kind text,
  source_id uuid,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.content, k.source_kind, k.source_id,
    (1 - (k.embedding <=> query_embedding))::double precision
  FROM public.knowledge_chunks k
  WHERE k.tenant_id = p_tenant_id
    AND k.embedding IS NOT NULL
    AND public.user_has_tenant_access(p_tenant_id)
    AND (
      p_article_ids IS NULL
      OR (k.source_kind = 'article' AND k.source_id = ANY (p_article_ids))
    )
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(uuid, vector, int, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int, uuid[]) TO postgres;

-- Next.js pool role (postgres) bypass for server-side voice + knowledge resolution
DROP POLICY IF EXISTS knowledge_bases_pool_all ON public.knowledge_bases;
CREATE POLICY knowledge_bases_pool_all ON public.knowledge_bases
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS ai_agent_kb_pool_all ON public.ai_agent_knowledge_bases;
CREATE POLICY ai_agent_kb_pool_all ON public.ai_agent_knowledge_bases
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);
