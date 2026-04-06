import { getPool } from "@/lib/db/pool";
import { createServiceRoleClient } from "@/lib/db/service-client";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { createVoiceFrontdeskSession } from "@/lib/voice-frontdesk/create-voice-frontdesk-session";
import { runVoiceFrontdeskTurnForSession } from "@/lib/voice-frontdesk/run-voice-frontdesk-turn";
import { resolveTenantIdByTwilioTo, getTelephonyForTenant } from "@/lib/telephony/settings";
import {
  getTwilioAuthToken,
  getTwilioGatherLanguage,
  getTwilioSayLanguage,
  getTwilioSayVoice,
} from "@/lib/twilio/env";
import { publicRequestUrl, absolutePathOnRequest } from "@/lib/twilio/public-request-url";
import { isValidTwilioSignature } from "@/lib/twilio/verify-signature";
import { createTwilioTtsPlayToken } from "@/lib/twilio/tts-play-token";
import { escapeXml, twimlResponse } from "@/lib/twilio/twiml";
import type { VoiceLanguage } from "@/lib/voice-frontdesk/types";
import {
  twilioCreditsError,
  twilioGenericError,
  twilioHangupAfterTimeouts,
  twilioInboundGreeting,
  twilioRepromptNoSpeech,
} from "@/lib/voice-frontdesk/twilio-phrases";

export const dynamic = "force-dynamic";

/** After this many Twilio Gather timeouts (no usable speech), end the call. */
const MAX_GATHER_TIMEOUT_ROUNDS = 6;

function ttsVoiceLangFromGatherBcp47(gatherLang: string): VoiceLanguage {
  return gatherLang.trim().toLowerCase().startsWith("ur") ? "ur" : "en";
}

async function formParamsToRecord(req: Request): Promise<Record<string, string>> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params[k] = v;
  }
  return params;
}

function gatherOpenTag(actionUrl: string, gatherLang: string) {
  const safeAction = escapeXml(actionUrl);
  const safeLang = escapeXml(gatherLang);
  return `<Gather input="speech" action="${safeAction}" method="POST" speechTimeout="auto" language="${safeLang}" speechModel="phone_call" timeout="15">`;
}

function sayStart(): string {
  const v = escapeXml(getTwilioSayVoice());
  const lang = escapeXml(getTwilioSayLanguage());
  return `<Say voice="${v}" language="${lang}">`;
}

/**
 * When Gather times out, Twilio runs the next verb — Redirect reprompts our webhook.
 * OpenAI TTS audio, then empty Gather (caller hears full clip before STT).
 */
function playOnlyGatherTwiml(
  playUrl: string,
  actionUrl: string,
  timeoutRedirectUrl: string,
  gatherLang: string
) {
  const go = gatherOpenTag(actionUrl, gatherLang);
  return `<Response>
  <Play>${escapeXml(playUrl)}</Play>
  ${go}</Gather>
  <Redirect method="POST">${escapeXml(timeoutRedirectUrl)}</Redirect>
</Response>`;
}

function gatherTimeoutRedirectUrl(req: Request, sessionId: string, nextTimeoutRound: number) {
  return absolutePathOnRequest(req, "/api/webhooks/twilio/voice", {
    sessionId,
    gatherMiss: "1",
    gr: String(nextTimeoutRound),
  });
}

/** Operator / misconfig messages only (no tenant TTS). */
function sayHangup(message: string) {
  return `<Response>${sayStart()}${escapeXml(message)}</Say><Hangup/></Response>`;
}

function playThenHangup(playUrl: string) {
  return `<Response><Play>${escapeXml(playUrl)}</Play><Hangup/></Response>`;
}

function escalateTwimlSay(message: string, dialE164: string | undefined) {
  const say = `${sayStart()}${escapeXml(message)}</Say>`;
  if (dialE164?.trim()) {
    const n = escapeXml(dialE164.trim());
    return `<Response>${say}<Dial>${n}</Dial></Response>`;
  }
  return `<Response>${say}<Hangup/></Response>`;
}

function playThenEscalateTwiml(playUrl: string, dialE164: string | undefined) {
  const safePlay = escapeXml(playUrl);
  if (dialE164?.trim()) {
    const n = escapeXml(dialE164.trim());
    return `<Response><Play>${safePlay}</Play><Dial>${n}</Dial></Response>`;
  }
  return `<Response><Play>${safePlay}</Play><Hangup/></Response>`;
}

export async function POST(req: Request) {
  const authToken = getTwilioAuthToken();
  if (!authToken) {
    return twimlResponse(sayHangup("This line is not configured."));
  }

  const url = publicRequestUrl(req);
  const params = await formParamsToRecord(req);
  const signature = req.headers.get("X-Twilio-Signature");
  if (!isValidTwilioSignature(authToken, signature, url, params)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!VOICE_CALLING_ENABLED) {
    return twimlResponse(sayHangup("Voice service is disabled."));
  }

  const callSid = params.CallSid ?? "";
  const from = params.From ?? "";
  const to = params.To ?? "";
  const speechResult = (params.SpeechResult ?? "").trim();
  const confidenceRaw = params.Confidence ? Number(params.Confidence) : NaN;
  const asrConfidence = Number.isFinite(confidenceRaw) ? confidenceRaw : undefined;

  const sessionIdFromQuery = new URL(req.url).searchParams.get("sessionId") ?? "";

  const pool = getPool();
  const tenantId = await resolveTenantIdByTwilioTo(pool, to);
  if (!tenantId) {
    return twimlResponse(sayHangup("This number is not linked to an organization."));
  }

  const supabase = createServiceRoleClient();

  const { data: settingsRow } = await supabase
    .from("settings")
    .select("ai_toggles, roman_urdu_support")
    .eq("tenant_id", tenantId)
    .single();
  const aiToggles = (settingsRow?.ai_toggles as Record<string, unknown> | null) ?? {};
  if (aiToggles.voice_frontdesk_enabled === false) {
    return twimlResponse(sayHangup("Voice front desk is disabled for this organization."));
  }

  const tenantAi = await getTenantAiSettings(supabase, tenantId);
  if (!tenantAi.voiceFrontdeskAi) {
    return twimlResponse(sayHangup("Voice assistant is disabled for this organization."));
  }

  if (!tenantAi.ttsEnabled || !isOpenAiConfigured()) {
    return twimlResponse(
      sayHangup(
        "The voice assistant needs speech playback and AI to be enabled. Please contact your administrator."
      )
    );
  }

  const telephony = await getTelephonyForTenant(pool, tenantId);
  const escalationE164 = telephony.twilio_escalation_e164;
  const gatherLang = getTwilioGatherLanguage();
  const phraseTtsLang = ttsVoiceLangFromGatherBcp47(gatherLang);

  const actionUrl = (sid: string) =>
    absolutePathOnRequest(req, "/api/webhooks/twilio/voice", { sessionId: sid });

  const romanUrdu = Boolean(settingsRow?.roman_urdu_support !== false);

  const ttsUrlFor = (text: string, lang: VoiceLanguage, roman: boolean) => {
    const token = createTwilioTtsPlayToken({
      tenantId,
      text,
      language: lang,
      romanUrdu: roman,
    });
    return absolutePathOnRequest(req, "/api/webhooks/twilio/tts", { t: token });
  };

  // --- Gather step: process speech ---
  if (sessionIdFromQuery) {
    const { data: vfs } = await supabase
      .from("voice_frontdesk_sessions")
      .select("id, twilio_call_sid, tenant_id")
      .eq("id", sessionIdFromQuery)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!vfs?.id || (vfs.twilio_call_sid as string | null) !== callSid) {
      return twimlResponse(sayHangup("Session mismatch. Please call again."));
    }

    const sid = vfs.id as string;
    const sp = new URL(req.url).searchParams;
    const gatherMiss = sp.get("gatherMiss") === "1";
    const grParsed = Number(sp.get("gr") ?? "0");
    const timeoutRound =
      Number.isFinite(grParsed) ? Math.min(99, Math.max(0, Math.floor(grParsed))) : 0;

    if (!speechResult) {
      if (gatherMiss && timeoutRound > MAX_GATHER_TIMEOUT_ROUNDS) {
        const hangText = twilioHangupAfterTimeouts(gatherLang);
        try {
          const u = ttsUrlFor(hangText, phraseTtsLang, romanUrdu);
          return twimlResponse(playThenHangup(u));
        } catch {
          return twimlResponse(sayHangup(hangText));
        }
      }
      const nextGr = gatherMiss ? timeoutRound + 1 : 1;
      const timeoutUrl = gatherTimeoutRedirectUrl(req, sid, nextGr);
      const reprompt = twilioRepromptNoSpeech(gatherLang);
      try {
        const u = ttsUrlFor(reprompt, phraseTtsLang, romanUrdu);
        return twimlResponse(playOnlyGatherTwiml(u, actionUrl(sid), timeoutUrl, gatherLang));
      } catch {
        return twimlResponse(
          sayHangup("Sorry, we could not play the prompt. Please call again.")
        );
      }
    }

    const turn = await runVoiceFrontdeskTurnForSession({
      supabase,
      tenantId,
      sessionId: sid,
      utterance: speechResult,
      asrConfidence,
    });

    if (!turn.ok) {
      const msg =
        turn.failure.status === 402 ? twilioCreditsError(gatherLang) : twilioGenericError(gatherLang);
      try {
        const u = ttsUrlFor(msg, phraseTtsLang, romanUrdu);
        return twimlResponse(
          playOnlyGatherTwiml(u, actionUrl(sid), gatherTimeoutRedirectUrl(req, sid, 1), gatherLang)
        );
      } catch {
        return twimlResponse(sayHangup(msg));
      }
    }

    const { data } = turn;
    if (data.shouldEscalate) {
      const msg = data.responseText || "Connecting you to a team member.";
      try {
        const u = ttsUrlFor(msg, data.language as VoiceLanguage, romanUrdu);
        return twimlResponse(playThenEscalateTwiml(u, escalationE164));
      } catch {
        return twimlResponse(escalateTwimlSay(msg, escalationE164));
      }
    }

    if (data.shouldEndCall) {
      const msg = data.responseText || "Goodbye.";
      try {
        const u = ttsUrlFor(msg, data.language as VoiceLanguage, romanUrdu);
        return twimlResponse(playThenHangup(u));
      } catch {
        return twimlResponse(sayHangup(msg));
      }
    }

    const afterTurnTimeout = gatherTimeoutRedirectUrl(req, sid, 1);
    const reply = data.responseText.trim() || twilioGenericError(gatherLang);

    try {
      const u = ttsUrlFor(reply, data.language as VoiceLanguage, romanUrdu);
      return twimlResponse(playOnlyGatherTwiml(u, actionUrl(sid), afterTurnTimeout, gatherLang));
    } catch {
      return twimlResponse(
        sayHangup("Sorry, we could not play the response. Please try again.")
      );
    }
  }

  // --- Initial connect ---
  const { data: existing } = await supabase
    .from("voice_frontdesk_sessions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  let sessionId: string;
  if (existing?.id) {
    sessionId = existing.id as string;
  } else {
    try {
      const created = await createVoiceFrontdeskSession({
        supabase,
        tenantId,
        callerPhone: from || null,
        callerName: null,
        twilioCallSid: callSid || null,
        twilioParentCallSid: params.ParentCallSid || null,
      });
      sessionId = created.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start session";
      return twimlResponse(sayHangup(msg.includes("customer") ? "No customer profile is set up." : "Unable to start your call."));
    }
  }

  const greeting = twilioInboundGreeting(gatherLang);
  try {
    const u = ttsUrlFor(greeting, phraseTtsLang, romanUrdu);
    return twimlResponse(
      playOnlyGatherTwiml(
        u,
        actionUrl(sessionId),
        gatherTimeoutRedirectUrl(req, sessionId, 1),
        gatherLang
      )
    );
  } catch {
    return twimlResponse(sayHangup("Sorry, we could not start the greeting. Please call again."));
  }
}
