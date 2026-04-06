-- Twilio inbound voice: tenant telephony config + session correlation

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS telephony jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.settings.telephony IS
  'Telephony integration: twilio_inbound_e164 (+E.164), twilio_escalation_e164 for human transfer Dial.';

CREATE UNIQUE INDEX IF NOT EXISTS settings_telephony_twilio_inbound_uidx
  ON public.settings ((telephony->>'twilio_inbound_e164'))
  WHERE (telephony->>'twilio_inbound_e164') IS NOT NULL
    AND btrim(telephony->>'twilio_inbound_e164') <> '';

ALTER TABLE public.voice_frontdesk_sessions
  ADD COLUMN IF NOT EXISTS twilio_call_sid text,
  ADD COLUMN IF NOT EXISTS twilio_parent_call_sid text;

CREATE UNIQUE INDEX IF NOT EXISTS voice_frontdesk_sessions_twilio_call_sid_uidx
  ON public.voice_frontdesk_sessions (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;
