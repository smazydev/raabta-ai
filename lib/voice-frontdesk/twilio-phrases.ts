import type { VoiceLanguage } from "./types";

function isUrduGather(bcp47: string): boolean {
  return bcp47.trim().toLowerCase().startsWith("ur");
}

/** Spoken via OpenAI TTS (Twilio &lt;Play&gt;) — Arabic script is OK. */
export function twilioInboundGreeting(gatherLangBcp47: string): string {
  if (isUrduGather(gatherLangBcp47)) {
    return "السلام علیکم، میں آپ کی مدد کے لیے موجود ہوں۔ بتائیے، آج میں کیسے مدد کر سکتا ہوں؟";
  }
  return "Hello, you have reached our assistant. How can I help you today?";
}

export function twilioRepromptNoSpeech(gatherLangBcp47: string): string {
  if (isUrduGather(gatherLangBcp47)) {
    return "معذرت، واضح سنائی نہیں دی۔ براہ کرم دوبارہ بولیں، آپ کس لیے کال کر رہے ہیں؟";
  }
  return "I did not catch that. Please say how we can help, or describe your issue.";
}

/** Short line inside Gather after assistant audio (Twilio &lt;Say&gt; / Polly). */
export function twilioGatherListeningHint(lang: VoiceLanguage): string {
  switch (lang) {
    case "sd":
      return "جڏھن تيار هجو ته ٻوليو۔";
    case "ps":
      return "کله چې تیار یاست، ووایاست۔";
    case "en":
      return "Go ahead whenever you are ready.";
    default:
      return "جب تیار ہوں تو آزادانہ بولیں۔";
  }
}

export function twilioAnythingElsePrompt(lang: VoiceLanguage): string {
  switch (lang) {
    case "sd":
      return "ڇا ٻي ڪا مدد؟";
    case "ps":
      return "نور څه مرسته؟";
    case "en":
      return "Anything else I can help with?";
    default:
      return "کیا میں مزید کچھ مدد کر سکتا ہوں؟";
  }
}

export function twilioCreditsError(gatherLangBcp47: string): string {
  if (isUrduGather(gatherLangBcp47)) {
    return "معذرت، اس وقت سروس دستیاب نہیں۔ بعد میں کوشش کریں یا انسانی نمائندے سے رابطہ کریں۔";
  }
  return "Sorry, speech credits are unavailable. Please try again later or hold for an agent.";
}

export function twilioGenericError(gatherLangBcp47: string): string {
  if (isUrduGather(gatherLangBcp47)) {
    return "معذرت، کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔";
  }
  return "Sorry, something went wrong. Please try again.";
}

export function twilioHangupAfterTimeouts(gatherLangBcp47: string): string {
  if (isUrduGather(gatherLangBcp47)) {
    return "معذرت، آواز واضح نہیں آرہی۔ اللہ حافظ۔";
  }
  return "I am having trouble hearing you. Goodbye.";
}
