import type { ChatLanguage } from "@/lib/ai/chat-languages";

let currentUrl: string | null = null;
let currentAudio: HTMLAudioElement | null = null;

export function stopOpenAiTtsPlayback() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

export type PlayOpenAiTtsOptions = {
  language?: ChatLanguage;
  /** When language is Urdu and replies use Roman Urdu (Latin), set true. */
  romanUrdu?: boolean;
};

/** Plays OpenAI TTS audio from POST /api/ai/tts (natural voice, not browser speechSynthesis). */
export async function playOpenAiTts(text: string, opts?: PlayOpenAiTtsOptions): Promise<void> {
  stopOpenAiTtsPlayback();

  const res = await fetch("/api/ai/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      ...(opts?.language != null
        ? { language: opts.language, romanUrdu: Boolean(opts.romanUrdu) }
        : {}),
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `TTS failed (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  currentUrl = url;

  const audio = new Audio(url);
  currentAudio = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      stopOpenAiTtsPlayback();
      resolve();
    };
    audio.onerror = () => {
      stopOpenAiTtsPlayback();
      reject(new Error("Audio playback failed"));
    };
    void audio.play().then(() => {}).catch(reject);
  });
}
