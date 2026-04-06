/**
 * When agent studio "model routing" holds a real OpenAI model id (e.g. gpt-5.4-mini),
 * we route that agent's traffic to it; otherwise tenant default / env applies.
 */
export function openAiModelIdFromPlaceholder(raw: string | null | undefined): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 64) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(s)) return null;
  return s;
}
