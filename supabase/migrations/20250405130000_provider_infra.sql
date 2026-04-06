-- AI provider platform: API keys, usage metering, audit export, connectors, deployment profile

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS provider_profile jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.settings.provider_profile IS
  'Deployment & AI policy hints: default_openai_model, deployment_region, data_residency_note, audit_export_webhook_url, etc.';

-- ---------------------------------------------------------------------------
-- Server-to-server API keys (Bearer rk_live_…)
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  secret_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['events:write', 'metrics:read', 'audit:read']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE UNIQUE INDEX tenant_api_keys_secret_hash_idx ON public.tenant_api_keys (secret_hash);
CREATE INDEX tenant_api_keys_tenant_idx ON public.tenant_api_keys (tenant_id);

-- ---------------------------------------------------------------------------
-- Usage metering (LLM tokens, workflow runs, API calls)
-- ---------------------------------------------------------------------------

CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'count',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_events_tenant_created ON public.usage_events (tenant_id, created_at DESC);
CREATE INDEX usage_events_type_idx ON public.usage_events (tenant_id, event_type);

-- ---------------------------------------------------------------------------
-- Audit trail for API + platform actions (export-friendly)
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'api',
  actor_label text,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_tenant_created ON public.audit_events (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Connector registry (named integration slots)
-- ---------------------------------------------------------------------------

CREATE TABLE public.connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  connector_type text NOT NULL CHECK (
    connector_type IN (
      'bank_core',
      'card_rail',
      'raast',
      'whatsapp',
      'telephony',
      'ats',
      'ticketing',
      'siem',
      'custom_http'
    )
  ),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected' CHECK (
    status IN ('disconnected', 'sandbox', 'connected', 'error', 'planned')
  ),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX connectors_tenant_idx ON public.connectors (tenant_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_api_keys_admin ON public.tenant_api_keys
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY usage_events_select_admin ON public.usage_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY audit_events_select_admin ON public.audit_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY connectors_select ON public.connectors
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY connectors_admin_write ON public.connectors
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());
