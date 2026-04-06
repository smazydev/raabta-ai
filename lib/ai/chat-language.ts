import { z } from "zod";
import { CHAT_LANGUAGE_CODES, type ChatLanguage } from "./chat-languages";

export { CHAT_LANGUAGE_CODES, type ChatLanguage, CHAT_LANGUAGE_OPTIONS } from "./chat-languages";

export const chatLanguageSchema = z.enum(CHAT_LANGUAGE_CODES);

export function parseChatLanguage(value: unknown): ChatLanguage {
  const p = chatLanguageSchema.safeParse(value);
  return p.success ? p.data : "en";
}

/** System-prompt fragment: output language and script for the assistant reply. */
export function languageInstruction(lang: ChatLanguage, romanUrdu: boolean): string {
  switch (lang) {
    case "en":
      return "Respond in clear, professional English suitable for a bank customer. Use English for the entire message.";
    case "ur":
      return romanUrdu
        ? "Respond entirely in Roman Urdu (Urdu in Latin letters). Do not use Arabic-script Urdu, Sindhi, or Pashto for the bulk of the reply."
        : "Respond entirely in standard Urdu using Arabic script (اردو). Do not switch to Roman Urdu, English, Sindhi, or Pashto except for unavoidable product codes or names.";
    case "ps":
      return "Respond entirely in Pashto (پښتو), preferably Arabic script. Do not default to Urdu or English; keep the full reply in Pashto except for unavoidable product codes.";
    case "sd":
      return "Respond entirely in Sindhi (سنڌي). Prefer Arabic script. If the customer wrote Sindhi in Latin letters, you may use consistent Latin transliteration for Sindhi—but do not reply in Urdu or Roman Urdu; those are different languages.";
    default:
      return languageInstruction("en", false);
  }
}

/** User-message reminder so the model does not drift to Urdu/English when Pashto/Sindhi/English is selected. */
export function strictOutputLanguageLine(lang: ChatLanguage, romanUrdu: boolean): string {
  switch (lang) {
    case "en":
      return "REQUIRED: Your entire next message must be in English only.";
    case "ur":
      return romanUrdu
        ? "REQUIRED: Your entire next message must be in Roman Urdu (Latin) only—not Arabic-script Urdu, not Sindhi."
        : "REQUIRED: Your entire next message must be in Arabic-script Urdu only—not Roman Urdu, not Sindhi or Pashto.";
    case "ps":
      return "REQUIRED: Your entire next message must be in Pashto only. Do not answer in Urdu or English.";
    case "sd":
      return "REQUIRED: Your entire next message must be in Sindhi only. Do not answer in Urdu, Roman Urdu, or English (except unavoidable codes like IBFT/ATM if needed).";
    default:
      return strictOutputLanguageLine("en", false);
  }
}

/** True if the string contains Arabic-script characters (Urdu/Sindhi/Pashto/Arabic, etc.). */
export function textContainsArabicScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Tenant "Roman Urdu" preference applies to Latin-only Urdu. If the model used Arabic script,
 * TTS must use the Arabic-script hint — otherwise gpt-4o-mini-tts sounds mumbled or wrong.
 */
export function effectiveRomanUrduForTts(text: string, tenantPrefersRomanUrdu: boolean): boolean {
  if (textContainsArabicScript(text)) return false;
  return tenantPrefersRomanUrdu;
}

/** OpenAI TTS `instructions` fragment: align spoken output with reply language / script. */
export function ttsLanguageInstructions(lang: ChatLanguage, romanUrdu: boolean): string {
  switch (lang) {
    case "en":
      return "Speak in clear English suitable for a bank customer. Use natural intonation.";
    case "ur":
      return romanUrdu
        ? "The text is Roman Urdu (Latin letters only). Speak it as fluent Urdu, not English letter-by-letter. Pause briefly between phrases. Any English product words: pronounce in English."
        : "The text is Arabic-script Urdu. Read it as normal spoken Urdu with clear pronunciation — do not spell out letters. Pause briefly between phrases. English product words: pronounce in English.";
    case "ps":
      return "Speak in Pashto throughout. Use Pashto pronunciation; do not read the text as Urdu.";
    case "sd":
      return "Speak in Sindhi throughout. Use Sindhi pronunciation; if Latin letters spell Sindhi words, read them as Sindhi not Urdu.";
    default:
      return ttsLanguageInstructions("en", false);
  }
}
