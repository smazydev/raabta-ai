-- Workflow manager (n8n-style): definitions, runs, step logs

CREATE TYPE public.workflow_trigger_type AS ENUM ('manual', 'intent_match');
CREATE TYPE public.workflow_run_status AS ENUM ('running', 'success', 'failed');
CREATE TYPE public.workflow_step_status AS ENUM ('success', 'failed', 'skipped');

CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  trigger_type public.workflow_trigger_type NOT NULL DEFAULT 'manual',
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels public.channel_type[] NOT NULL DEFAULT ARRAY['web_chat', 'app_chat', 'whatsapp', 'voice']::public.channel_type[],
  definition jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  version int NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX workflows_tenant_enabled_idx ON public.workflows (tenant_id, enabled);
CREATE INDEX workflows_tenant_sort_idx ON public.workflows (tenant_id, sort_order);

CREATE TABLE public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  triggered_by uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
  status public.workflow_run_status NOT NULL DEFAULT 'running',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text
);

CREATE INDEX workflow_runs_tenant_started_idx ON public.workflow_runs (tenant_id, started_at DESC);
CREATE INDEX workflow_runs_workflow_idx ON public.workflow_runs (workflow_id);

CREATE TABLE public.workflow_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.workflow_runs (id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status public.workflow_step_status NOT NULL,
  input_redacted jsonb,
  output_redacted jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_run_steps_run_idx ON public.workflow_run_steps (run_id);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_run_steps ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'::public.app_role
  )
$$;

-- Workflows: read tenant; mutate admin only
CREATE POLICY workflows_select ON public.workflows
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY workflows_insert ON public.workflows
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY workflows_update ON public.workflows
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY workflows_delete ON public.workflows
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin());

-- Runs: tenant members can create and read (operators trigger workflows)
CREATE POLICY workflow_runs_select ON public.workflow_runs
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY workflow_runs_insert ON public.workflow_runs
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY workflow_runs_update ON public.workflow_runs
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Steps: via parent run tenant
CREATE POLICY workflow_run_steps_all ON public.workflow_run_steps
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflow_runs r
      WHERE r.id = run_id AND r.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflow_runs r
      WHERE r.id = run_id AND r.tenant_id = public.current_tenant_id()
    )
  );
