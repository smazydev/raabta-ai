-- Remove whatsapp from channel_type enum, connectors, and tenant channel flags.

-- Data: remap channels and strip JSON key
UPDATE public.conversations SET channel = 'web_chat' WHERE channel = 'whatsapp';
UPDATE public.complaints SET channel = 'web_chat' WHERE channel = 'whatsapp';
UPDATE public.workflows
SET channels = array_replace(channels, 'whatsapp'::public.channel_type, 'web_chat'::public.channel_type);
UPDATE public.settings SET channels_enabled = channels_enabled - 'whatsapp';
DELETE FROM public.connectors WHERE connector_type = 'whatsapp';

-- Connectors: drop and recreate CHECK (remove whatsapp from allowed list)
ALTER TABLE public.connectors DROP CONSTRAINT IF EXISTS connectors_connector_type_check;
ALTER TABLE public.connectors ADD CONSTRAINT connectors_connector_type_check CHECK (
  connector_type IN (
    'bank_core',
    'card_rail',
    'raast',
    'telephony',
    'ats',
    'ticketing',
    'siem',
    'custom_http'
  )
);

-- channel_type enum without whatsapp
ALTER TYPE public.channel_type RENAME TO channel_type_old;

CREATE TYPE public.channel_type AS ENUM (
  'web_chat',
  'app_chat',
  'voice',
  'agent_assist'
);

ALTER TABLE public.conversations
  ALTER COLUMN channel TYPE public.channel_type
  USING (channel::text::public.channel_type);

ALTER TABLE public.complaints
  ALTER COLUMN channel TYPE public.channel_type
  USING (channel::text::public.channel_type);

ALTER TABLE public.workflows
  ALTER COLUMN channels DROP DEFAULT;

-- USING cannot contain subqueries (e.g. ARRAY(SELECT ...)); use a helper that runs the subquery inside the function body.
CREATE OR REPLACE FUNCTION public._migrate_workflow_channels_array(ch public.channel_type_old[])
RETURNS public.channel_type[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN ch IS NULL THEN NULL
    ELSE COALESCE(
      (
        SELECT array_agg(x::text::public.channel_type ORDER BY n)
        FROM unnest(ch) WITH ORDINALITY AS t(x, n)
      ),
      ARRAY[]::public.channel_type[]
    )
  END;
$$;

ALTER TABLE public.workflows
  ALTER COLUMN channels TYPE public.channel_type[]
  USING (public._migrate_workflow_channels_array(channels));

DROP FUNCTION public._migrate_workflow_channels_array(public.channel_type_old[]);

ALTER TABLE public.workflows
  ALTER COLUMN channels SET DEFAULT ARRAY['web_chat', 'app_chat', 'voice']::public.channel_type[];

DROP TYPE public.channel_type_old;

ALTER TABLE public.settings
  ALTER COLUMN channels_enabled SET DEFAULT '{"web_chat":true,"app_chat":true,"voice":true,"agent_assist":true}'::jsonb;
