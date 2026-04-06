import type { VoiceLanguage } from "./types";

export type LanguageFlags = {
  urduEnabled: boolean;
  sindhiEnabled: boolean;
  pashtoEnabled: boolean;
};

export function languageFlagsFromEnv(): LanguageFlags {
  return {
    urduEnabled: true,
    sindhiEnabled: process.env.FEATURE_LANG_SD === "true",
    pashtoEnabled: process.env.FEATURE_LANG_PS === "true",
  };
}

export function detectLanguageFromText(input: string): { language: VoiceLanguage; confidence: number } {
  const t = input.trim();
  if (!t) return { language: "ur", confidence: 0.3 };
  if (/[ٹپڈڑںھہئےاآبتثجچحخدذرزسشصضطظعغفقکگلمنو]/.test(t)) {
    return { language: "ur", confidence: 0.82 };
  }
  const low = t.toLowerCase();
  if (/\b(assalam|janab|urdu|shukriya|masla)\b/.test(low)) {
    return { language: "ur", confidence: 0.72 };
  }
  if (/\b(sindhi|ادا|مهرباني)\b/.test(low)) {
    return { language: "sd", confidence: 0.62 };
  }
  if (/\b(pashto|manana|za)\b/.test(low)) {
    return { language: "ps", confidence: 0.62 };
  }
  // Ambiguous Latin / short utterances: default Urdu for regional voice (not English).
  return { language: "ur", confidence: 0.52 };
}

export function resolveLanguage(
  requested: VoiceLanguage,
  flags: LanguageFlags
): { language: VoiceLanguage; degraded: boolean } {
  if (requested === "ur" && flags.urduEnabled) return { language: "ur", degraded: false };
  if (requested === "sd" && flags.sindhiEnabled) return { language: "sd", degraded: false };
  if (requested === "ps" && flags.pashtoEnabled) return { language: "ps", degraded: false };
  // Hierarchy when a language is unavailable: Urdu first, then Sindhi, then Pashto, then English.
  if (requested === "ps" && flags.sindhiEnabled) return { language: "sd", degraded: true };
  if ((requested === "sd" || requested === "ps") && flags.urduEnabled) return { language: "ur", degraded: true };
  if (flags.urduEnabled) return { language: "ur", degraded: true };
  if (flags.sindhiEnabled) return { language: "sd", degraded: true };
  if (flags.pashtoEnabled) return { language: "ps", degraded: true };
  return { language: "en", degraded: true };
}
