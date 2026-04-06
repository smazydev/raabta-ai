-- Enterprise control plane: agent studio fields, knowledge governance columns,
-- workflow catalog metadata, voice session ↔ agent linkage, junction tables.

-- Channel coverage for agents (chat / voice / both)
ALTER TYPE public.ai_agent_kind ADD VALUE IF NOT EXISTS 'both';

CREATE TYPE public.ai_agent_status AS ENUM ('draft', 'live', 'archived');

CREATE TYPE public.ai_agent_department AS ENUM (
  'HR',
  'IT',
  'Operations',
  'Compliance',
  'Support'
);

ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS status public.ai_agent_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS department public.ai_agent_department,
  ADD COLUMN IF NOT EXISTS response_style text,
  ADD COLUMN IF NOT EXISTS escalation_target_team text,
  ADD COLUMN IF NOT EXISTS citations_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_handoff_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS agent_assist_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS model_placeholder text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE public.ai_agents
SET
  status = 'live',
  published_at = COALESCE(published_at, updated_at)
WHERE status = 'draft';

ALTER TABLE public.knowledge_articles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal_policy',
  ADD COLUMN IF NOT EXISTS department_team text,
  ADD COLUMN IF NOT EXISTS access_scope text NOT NULL DEFAULT 'tenant_wide',
  ADD COLUMN IF NOT EXISTS readiness text NOT NULL DEFAULT 'indexed';

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.voice_frontdesk_sessions
  ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES public.ai_agents (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retrieved_knowledge jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS handoff_state text,
  ADD COLUMN IF NOT EXISTS structured_summary text;

CREATE TABLE IF NOT EXISTS public.ai_agent_knowledge_articles (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents (id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES public.knowledge_articles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, article_id)
);

CREATE INDEX IF NOT EXISTS ai_agent_ka_tenant_idx
  ON public.ai_agent_knowledge_articles (tenant_id);

CREATE TABLE IF NOT EXISTS public.ai_agent_workflow_allowlist (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.ai_agents (id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, workflow_id)
);

CREATE INDEX IF NOT EXISTS ai_agent_wf_tenant_idx
  ON public.ai_agent_workflow_allowlist (tenant_id);

ALTER TABLE public.ai_agent_knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_workflow_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_ka_all ON public.ai_agent_knowledge_articles
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY ai_agent_wf_all ON public.ai_agent_workflow_allowlist
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Backfill allowlist from legacy single workflow_id
INSERT INTO public.ai_agent_workflow_allowlist (tenant_id, agent_id, workflow_id)
SELECT a.tenant_id, a.id, a.workflow_id
FROM public.ai_agents a
WHERE a.workflow_id IS NOT NULL
ON CONFLICT (agent_id, workflow_id) DO NOTHING;
