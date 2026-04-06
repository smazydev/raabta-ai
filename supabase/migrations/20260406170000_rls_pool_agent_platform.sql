-- Next.js uses a direct Postgres pool (role `postgres`); RLS policies scoped to `authenticated`
-- see auth.uid() = NULL and deny rows. These permissive policies let the app server access tenant
-- data when connecting as `postgres` (still not exposed to PostgREST anon/authenticated clients).

DROP POLICY IF EXISTS ai_agents_pool_all ON public.ai_agents;
CREATE POLICY ai_agents_pool_all ON public.ai_agents
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS ai_agent_ka_pool_all ON public.ai_agent_knowledge_articles;
CREATE POLICY ai_agent_ka_pool_all ON public.ai_agent_knowledge_articles
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS ai_agent_wf_pool_all ON public.ai_agent_workflow_allowlist;
CREATE POLICY ai_agent_wf_pool_all ON public.ai_agent_workflow_allowlist
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- Operator labels on agent detail (created_by / updated_by → profiles)
DROP POLICY IF EXISTS profiles_select_pool ON public.profiles;
CREATE POLICY profiles_select_pool ON public.profiles
  FOR SELECT
  TO postgres
  USING (true);
