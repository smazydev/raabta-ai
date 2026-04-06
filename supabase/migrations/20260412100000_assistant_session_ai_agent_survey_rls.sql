-- Copilot: optional governed agent per session (persona + KB scope from Agent studio).
ALTER TABLE public.assistant_sessions
  ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES public.ai_agents (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS assistant_sessions_ai_agent_idx ON public.assistant_sessions (ai_agent_id)
  WHERE ai_agent_id IS NOT NULL;

-- Assistant tools: no admin-only survey gates at the DB layer (tenant isolation only).
DROP POLICY IF EXISTS survey_templates_admin_write ON public.survey_templates;
DROP POLICY IF EXISTS survey_templates_admin_update ON public.survey_templates;
DROP POLICY IF EXISTS survey_templates_admin_delete ON public.survey_templates;

CREATE POLICY survey_templates_tenant_insert ON public.survey_templates
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY survey_templates_tenant_update ON public.survey_templates
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY survey_templates_tenant_delete ON public.survey_templates
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS survey_assignments_admin_write ON public.survey_assignments;

CREATE POLICY survey_assignments_tenant_all ON public.survey_assignments
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
