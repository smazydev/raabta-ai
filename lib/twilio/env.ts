/** Twilio Console auth token — used to validate inbound webhook signatures. */
export function getTwilioAuthToken(): string | null {
  const t = process.env.TWILIO_AUTH_TOKEN?.trim();
  return t || null;
}

/**
 * Twilio Gather speech language (BCP-47). Default ur-PK so Urdu callers are understood;
 * use en-US / en-IN if Twilio rejects ur-PK for your account.
 */
export function getTwilioGatherLanguage(): string {
  const v = process.env.TWILIO_GATHER_LANGUAGE?.trim();
  return v || "ur-PK";
}

/**
 * Voice for TwiML &lt;Say&gt; (Amazon Polly / Google). Default neural Joanna reads Roman Urdu clearly;
 * Arabic-script Urdu sounds broken on English voices.
 */
export function getTwilioSayVoice(): string {
  return process.env.TWILIO_SAY_VOICE?.trim() || "Polly.Joanna-Neural";
}

/** BCP-47 for Say when using Latin/Roman Urdu text. */
export function getTwilioSayLanguage(): string {
  return process.env.TWILIO_SAY_LANGUAGE?.trim() || "en-US";
}

/**
 * HMAC secret for short-lived TTS play URLs (Twilio Play verb). Prefer TWILIO_TTS_PLAY_SECRET;
 * falls back to SESSION_SECRET when unset (min 16 chars).
 */
export function getTwilioTtsPlaySecret(): string {
  const s =
    process.env.TWILIO_TTS_PLAY_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || "";
  if (s.length < 16) {
    throw new Error(
      "Set TWILIO_TTS_PLAY_SECRET (recommended) or SESSION_SECRET (≥16 chars) for Twilio TTS play URLs."
    );
  }
  return s;
}
