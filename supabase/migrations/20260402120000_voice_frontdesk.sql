-- Voice front-desk: multilingual short-call intake + disposition

CREATE TYPE public.frontdesk_outcome AS ENUM (
  'resolved',
  'transferred',
  'callback_scheduled',
  'ticket_created',
  'dropped',
  'failed'
);

CREATE TYPE public.frontdesk_request_type AS ENUM (
  'ticket',
  'callback',
  'lead'
);

CREATE TABLE public.voice_frontdesk_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL,
  caller_phone text,
  caller_name text,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  preferred_language text NOT NULL DEFAULT 'ur',
  language_locked boolean NOT NULL DEFAULT false,
  detected_intent text,
  urgency text,
  callback_requested boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  outcome public.frontdesk_outcome,
  transfer_reason text,
  summary text,
  disposition jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX voice_frontdesk_sessions_tenant_created_idx
  ON public.voice_frontdesk_sessions (tenant_id, created_at DESC);
CREATE INDEX voice_frontdesk_sessions_tenant_lang_idx
  ON public.voice_frontdesk_sessions (tenant_id, preferred_language);
CREATE INDEX voice_frontdesk_sessions_tenant_status_idx
  ON public.voice_frontdesk_sessions (tenant_id, status);

CREATE TABLE public.voice_frontdesk_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.voice_frontdesk_sessions (id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (actor IN ('caller', 'assistant', 'system')),
  language text,
  text text NOT NULL,
  redacted_text text,
  confidence numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX voice_frontdesk_turns_session_idx
  ON public.voice_frontdesk_turns (session_id, created_at);

CREATE TABLE public.frontdesk_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.voice_frontdesk_sessions (id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  request_type public.frontdesk_request_type NOT NULL,
  external_ref text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX frontdesk_requests_tenant_created_idx
  ON public.frontdesk_requests (tenant_id, created_at DESC);

ALTER TABLE public.voice_frontdesk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_frontdesk_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frontdesk_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY vfs_all ON public.voice_frontdesk_sessions
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY vft_all ON public.voice_frontdesk_turns
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY fdr_all ON public.frontdesk_requests
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
