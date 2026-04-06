-- Raabta AI — initial schema (single demo tenant, RLS)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'agent');
CREATE TYPE public.channel_type AS ENUM (
  'web_chat',
  'app_chat',
  'whatsapp',
  'voice',
  'agent_assist'
);
CREATE TYPE public.conversation_status AS ENUM (
  'active',
  'escalated',
  'resolved',
  'pending'
);
CREATE TYPE public.complaint_status AS ENUM (
  'new',
  'in_review',
  'awaiting_customer',
  'escalated',
  'resolved',
  'closed'
);
CREATE TYPE public.priority AS ENUM ('low', 'medium', 'high', 'critical');

-- Tenants
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- App users (credentials live in Postgres — works on RDS without Supabase Auth)
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Profiles (1:1 app_users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES public.app_users (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'agent',
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_tenant_idx ON public.profiles (tenant_id);

-- Customers
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  email text,
  account_number text,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customers_tenant_idx ON public.customers (tenant_id);

-- Cards
CREATE TABLE public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  last_four text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'frozen')),
  product text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cards_customer_idx ON public.cards (customer_id);

-- Transactions
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  card_id uuid REFERENCES public.cards (id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'PKR',
  description text NOT NULL,
  category text,
  status text NOT NULL DEFAULT 'completed' CHECK (
    status IN ('completed', 'pending', 'failed', 'suspicious')
  )
);

CREATE INDEX transactions_customer_idx ON public.transactions (customer_id);

-- Conversations
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  channel public.channel_type NOT NULL,
  status public.conversation_status NOT NULL DEFAULT 'active',
  intent text,
  sentiment text,
  summary text,
  containment_resolved boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_tenant_idx ON public.conversations (tenant_id);

CREATE TABLE public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('customer', 'ai', 'agent')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversation_messages_conv_idx ON public.conversation_messages (conversation_id);

-- Calls (voice simulator)
CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  status public.conversation_status NOT NULL DEFAULT 'active',
  duration_seconds int,
  language text DEFAULT 'English',
  intent text,
  outcome text,
  summary text,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

-- Complaints
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  reference text NOT NULL,
  channel public.channel_type NOT NULL,
  category text NOT NULL,
  priority public.priority NOT NULL DEFAULT 'medium',
  status public.complaint_status NOT NULL DEFAULT 'new',
  summary text NOT NULL,
  sla_due_at timestamptz,
  assigned_team text,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL,
  call_id uuid REFERENCES public.calls (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX complaints_reference_tenant ON public.complaints (tenant_id, reference);

CREATE TABLE public.complaint_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  complaint_id uuid NOT NULL REFERENCES public.complaints (id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cases (correlation)
CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  title text NOT NULL,
  complaint_id uuid REFERENCES public.complaints (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL,
  call_id uuid REFERENCES public.calls (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE CASCADE,
  complaint_id uuid REFERENCES public.complaints (id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls (id) ON DELETE CASCADE,
  summary text NOT NULL,
  suggested_reply text,
  next_actions jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Knowledge base
CREATE TABLE public.knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  usage_count int NOT NULL DEFAULT 0,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_articles_search_idx ON public.knowledge_articles USING gin (search_vector);

-- Live events & alerts
CREATE TABLE public.live_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX live_events_tenant_created ON public.live_events (tenant_id, created_at DESC);

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Settings (per tenant)
CREATE TABLE public.settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  app_name text NOT NULL DEFAULT 'Raabta AI',
  channels_enabled jsonb NOT NULL DEFAULT '{"web_chat":true,"app_chat":true,"whatsapp":true,"voice":true,"agent_assist":true}'::jsonb,
  ai_toggles jsonb NOT NULL DEFAULT '{"auto_reply":true,"summaries":true}'::jsonb,
  escalation_threshold int NOT NULL DEFAULT 3,
  roman_urdu_support boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.user_has_tenant_access(t_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.tenant_id = t_id
  )
$$;

-- Policies: authenticated users with a profile may read/write their tenant rows
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(id));

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR tenant_id = public.current_tenant_id());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY customers_all ON public.customers
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY cards_all ON public.cards
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY transactions_all ON public.transactions
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY conversations_all ON public.conversations
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY conversation_messages_all ON public.conversation_messages
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY calls_all ON public.calls
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY complaints_all ON public.complaints
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY complaint_notes_all ON public.complaint_notes
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY cases_all ON public.cases
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY agent_summaries_all ON public.agent_summaries
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY knowledge_all ON public.knowledge_articles
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY live_events_all ON public.live_events
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY alerts_all ON public.alerts
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY settings_all ON public.settings
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
