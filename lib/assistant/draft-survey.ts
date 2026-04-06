import { getOpenAI } from "@/lib/ai/openai";
import { sliceFromCompletionUsage } from "@/lib/billing/map-openai-usage";
import type { TokenUsageSlice } from "@/lib/billing/pricing";

export async function draftSurveyQuestionsWithAi(input: {
  topic: string;
  audienceNotes?: string;
  model?: string;
  onUsage?: (usage: TokenUsageSlice | null) => void;
}): Promise<unknown[]> {
  const openai = getOpenAI();
  const model = input.model?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You draft short employee surveys. Return JSON: { "questions": [ ... ] }.
Each question: { "id": string (unique slug), "type": "text" | "choice", "prompt": string, "options"?: string[] }.
Use 4–8 questions. Keep language professional and inclusive. No medical or discriminatory items.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          topic: input.topic,
          audience_context: input.audienceNotes ?? "",
        }),
      },
    ],
  });
  const usage: TokenUsageSlice | null = res.usage ? sliceFromCompletionUsage(res.usage) : null;
  input.onUsage?.(usage);
  const raw = res.choices[0]?.message?.content ?? "{}";
  let parsed: { questions?: unknown[] };
  try {
    parsed = JSON.parse(raw) as { questions?: unknown[] };
  } catch {
    return [];
  }
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}
