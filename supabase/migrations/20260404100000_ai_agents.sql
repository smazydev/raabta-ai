-- Tenant-defined chat / voice agent personas (builder surface + runtime instructions).

CREATE TYPE public.ai_agent_kind AS ENUM ('chat', 'voice');

CREATE TABLE public.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  kind public.ai_agent_kind NOT NULL DEFAULT 'chat',
  description text,
  instructions text NOT NULL DEFAULT '',
  workflow_id uuid REFERENCES public.workflows (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX ai_agents_tenant_idx ON public.ai_agents (tenant_id);
CREATE INDEX ai_agents_tenant_kind_idx ON public.ai_agents (tenant_id, kind);

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.ai_agents (id) ON DELETE SET NULL;

CREATE INDEX conversations_agent_idx ON public.conversations (agent_id)
  WHERE agent_id IS NOT NULL;

ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agents_all ON public.ai_agents
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
