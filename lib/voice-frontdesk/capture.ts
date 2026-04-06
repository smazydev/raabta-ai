import type { CaptureState, VoiceLanguage } from "./types";

export const PHONE_RE = /(\+?\d[\d\s-]{8,}\d)/;
const REF_RE = /\b([A-Z]{2,5}-?\d{3,10})\b/i;

/** Roman / Latin name token(s) after common intro phrases (STT often returns Roman Urdu). */
const NAME_LATIN_CHUNK = String.raw`([a-zA-Z][a-zA-Z.'\s-]{0,40}[a-zA-Z]|[a-zA-Z]{2,30})`;

/** Single-word reply that is probably not a name when we're fishing for callerName. */
const NOT_A_NAME_WORD = new Set(
  [
    "hello",
    "hi",
    "hey",
    "yes",
    "yeah",
    "no",
    "nope",
    "ok",
    "okay",
    "thanks",
    "thank",
    "please",
    "help",
    "ji",
    "han",
    "haan",
    "nahi",
    "nahin",
    "nai",
    "the",
    "and",
    "but",
    "call",
    "goodbye",
    "bye",
    "wait",
    "sorry",
  ].map((w) => w.toLowerCase())
);

function trimName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Pull caller name from English, Roman Urdu ("mera naam Ali hai"), or Urdu script.
 */
export function extractCallerNameFromUtterance(utterance: string): string | undefined {
  const t = utterance.trim();
  if (!t) return undefined;
  const low = t.toLowerCase();

  const phrasePatterns: RegExp[] = [
    /\b(?:my name is|i am|i'm|im|name is)\s+([a-zA-Z][a-zA-Z.'\s-]{0,40}[a-zA-Z]|[a-zA-Z]{2,30})\b/,
    /\bmain\s+([a-zA-Z][a-zA-Z.'\s-]{0,40}[a-zA-Z]|[a-zA-Z]{2,30})\s+(?:hoon|hun|hu)\b/,
    new RegExp(String.raw`\bmera naa?m\s+${NAME_LATIN_CHUNK}\s+hai\b`, "i"),
    new RegExp(String.raw`\bmera naa?m\s+hai\s+${NAME_LATIN_CHUNK}\b`, "i"),
    new RegExp(String.raw`\bnaa?m\s+${NAME_LATIN_CHUNK}\s+hai\b`, "i"),
    // Urdu script
    /میرا نام\s+(.+?)\s+ہے/u,
    /نام\s+(.+?)\s+ہے/u,
  ];

  for (const re of phrasePatterns) {
    const m = t.match(re) ?? low.match(re);
    if (m?.[1]) {
      const name = trimName(m[1]);
      if (name.length >= 2 && name.length <= 50) return name;
    }
  }

  // Short reply after "please say your name" — e.g. "Ali" or "علی" only.
  if (/^[\s"'“”‘’]*[a-zA-Z\u0600-\u06FF][a-zA-Z\u0600-\u06FF.'\s-]{0,48}[a-zA-Z\u0600-\u06FF][\s"'“”‘’]*$/u.test(t)) {
    const single = trimName(t.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, ""));
    const words = single.split(/\s+/).filter(Boolean);
    if (words.length <= 3 && single.length >= 2 && single.length <= 40) {
      const asciiWord = /^[a-zA-Z.'-]+$/.test(single);
      if (asciiWord && NOT_A_NAME_WORD.has(single.toLowerCase())) return undefined;
      return single;
    }
  }

  return undefined;
}

/** Digits from this utterance only (not session capture). Used for hiring status so we always ask for the application number. */
export function extractPhoneFromUtterance(utterance: string): string | undefined {
  const phone = utterance.match(PHONE_RE)?.[1]?.replace(/\s|-/g, "");
  if (phone) return phone;
  const d = utterance.replace(/\D/g, "");
  if (d.length >= 10 && d.length <= 15) return d;
  return undefined;
}

export function updateCaptureFromUtterance(
  current: CaptureState,
  utterance: string
): CaptureState {
  const next = { ...current };
  const phone = utterance.match(PHONE_RE)?.[1]?.replace(/\s|-/g, "");
  if (phone) next.phoneNumber = phone;
  const ref = utterance.match(REF_RE)?.[1];
  if (ref) next.customerReference = ref.toUpperCase();

  const low = utterance.toLowerCase();
  if (!next.callerName) {
    const fromPhrase = extractCallerNameFromUtterance(utterance);
    if (fromPhrase) next.callerName = fromPhrase;
  }
  if (/\b(urgent|immediate|fawri)\b/.test(low)) next.urgencyLevel = "high";
  else if (!next.urgencyLevel) next.urgencyLevel = "medium";

  if (/\b(callback|call back|wapis call)\b/.test(low)) next.callbackRequested = true;
  if (!next.reasonForCall && utterance.trim().length > 8) next.reasonForCall = utterance.trim();
  return next;
}

export function isCaptureComplete(s: CaptureState): boolean {
  return Boolean(s.phoneNumber && s.reasonForCall && s.preferredLanguage);
}

/** What structured intake still needs (same gates as nextQuestionForMissingField). */
export function missingIntakeFields(s: CaptureState): { name: boolean; phone: boolean; reason: boolean } {
  return {
    name: !s.callerName,
    phone: !s.phoneNumber,
    reason: !s.reasonForCall,
  };
}

export function nextQuestionForMissingField(lang: VoiceLanguage, s: CaptureState): string | null {
  if (!s.callerName) {
    if (lang === "sd") return "مهرباني ڪري پنهنجو نالو چئو۔";
    if (lang === "ps") return "مهرباني وکړئ، خپل نوم راکړئ۔";
    return lang === "ur" ? "برائے مہربانی اپنا نام بتائیں۔" : "Please share your name.";
  }
  if (!s.phoneNumber) {
    if (lang === "sd") return "موبائل نمبر چئو، مثال طور 03XXXXXXXXX۔";
    if (lang === "ps") return "د اړیکې لپاره موبایل نمبر ووایاست، لکه 03XXXXXXXXX۔";
    return lang === "ur"
      ? "اپنا فون نمبر کنفرم کریں، جیسے 03xxxxxxxxx۔"
      : "Please confirm your phone number.";
  }
  if (!s.reasonForCall) {
    if (lang === "sd") return "مختصر چئو اها ڪال ڪهڙي مسئلي لاءِ آهي؟";
    if (lang === "ps") return "لنډیز ووایاست چې د کومې ستونزې لپاره زنګ وهئ؟";
    return lang === "ur" ? "مختصر بتائیں آپ کس مسئلے کے لیے کال کر رہے ہیں؟" : "Please share reason for call.";
  }
  return null;
}
