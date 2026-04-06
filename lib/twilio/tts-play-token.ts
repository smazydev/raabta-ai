import { createHmac, timingSafeEqual } from "crypto";
import type { VoiceLanguage } from "@/lib/voice-frontdesk/types";
import { getTwilioTtsPlaySecret } from "./env";

const MAX_TEXT = 900;
const TTL_MS = 5 * 60 * 1000;

export type TwilioTtsTokenPayload = {
  tenantId: string;
  text: string;
  lang: VoiceLanguage;
  romanUrdu: boolean;
  exp: number;
};

function encodePayload(p: TwilioTtsTokenPayload): string {
  const json = JSON.stringify(p);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", getTwilioTtsPlaySecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function createTwilioTtsPlayToken(input: {
  tenantId: string;
  text: string;
  language: VoiceLanguage;
  romanUrdu: boolean;
}): string {
  const text = input.text.trim().slice(0, MAX_TEXT);
  if (!text) throw new Error("Empty TTS text");
  const payload: TwilioTtsTokenPayload = {
    tenantId: input.tenantId,
    text,
    lang: input.language,
    romanUrdu: input.romanUrdu,
    exp: Date.now() + TTL_MS,
  };
  return encodePayload(payload);
}

export function verifyTwilioTtsPlayToken(token: string): TwilioTtsTokenPayload | null {
  try {
    const secret = getTwilioTtsPlaySecret();
    const dot = token.indexOf(".");
    if (dot < 1) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", secret).update(body).digest("base64url");
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const json = Buffer.from(body, "base64url").toString("utf8");
    const p = JSON.parse(json) as TwilioTtsTokenPayload;
    if (
      typeof p.tenantId !== "string" ||
      typeof p.text !== "string" ||
      typeof p.exp !== "number" ||
      typeof p.lang !== "string"
    ) {
      return null;
    }
    if (Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}
