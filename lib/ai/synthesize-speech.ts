import { getOpenAI } from "./openai";
import { effectiveRomanUrduForTts, ttsLanguageInstructions } from "./chat-language";
import type { ChatLanguage } from "./chat-languages";

const MAX_INPUT_CHARS = 4096;

const VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
]);

export type SynthesizeSpeechOptions = {
  /** When set, appended to TTS instructions so pronunciation matches chat reply language. */
  language?: ChatLanguage;
  /** Urdu + Roman Urdu (Latin) text from the model; only used when language is `ur`. */
  romanUrdu?: boolean;
};

/** OpenAI TTS: natural voice (mp3). Key stays server-side. */
export async function synthesizeSpeechMp3(
  input: string,
  opts?: SynthesizeSpeechOptions
): Promise<Buffer> {
  const text = input.trim().slice(0, MAX_INPUT_CHARS);
  if (!text) throw new Error("Text is required for speech");

  const openai = getOpenAI();
  const model =
    process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
  const fromEnv = process.env.OPENAI_TTS_VOICE?.trim().toLowerCase();
  const voice = (fromEnv && VOICES.has(fromEnv) ? fromEnv : "nova") as
    | "alloy"
    | "ash"
    | "ballad"
    | "coral"
    | "echo"
    | "fable"
    | "onyx"
    | "nova"
    | "sage"
    | "shimmer"
    | "verse";

  const base = {
    model,
    voice,
    input: text,
    response_format: "mp3" as const,
  };

  const usesInstructions = model !== "tts-1" && model !== "tts-1-hd";
  const baseStyle =
    process.env.OPENAI_TTS_INSTRUCTIONS?.trim() ||
    "Speak for a phone line: moderate pace, crisp consonants, short pauses between phrases. Calm professional bank support tone; not robotic.";

  const romanUrduForTts =
    opts?.language === "ur"
      ? effectiveRomanUrduForTts(text, Boolean(opts.romanUrdu))
      : Boolean(opts?.romanUrdu);

  const langHint =
    opts?.language != null ? ttsLanguageInstructions(opts.language, romanUrduForTts) : "";
  const instructions = [baseStyle, langHint].filter(Boolean).join(" ");

  const speedRaw = process.env.OPENAI_TTS_SPEED?.trim();
  const speedParsed = speedRaw ? Number(speedRaw) : NaN;
  const speed =
    !usesInstructions && Number.isFinite(speedParsed)
      ? Math.min(4, Math.max(0.25, speedParsed))
      : !usesInstructions
        ? 0.9
        : undefined;

  const res = await openai.audio.speech.create(
    usesInstructions
      ? { ...base, instructions }
      : speed != null
        ? { ...base, speed }
        : base
  );

  return Buffer.from(await res.arrayBuffer());
}
