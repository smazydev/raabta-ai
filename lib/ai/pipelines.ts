import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getOpenAI } from "./openai";
import { languageInstruction, strictOutputLanguageLine } from "./chat-language";
import type { ChatLanguage } from "./chat-languages";
import type { TokenUsageSlice } from "@/lib/billing/pricing";
import { sliceFromCompletionUsage } from "@/lib/billing/map-openai-usage";

export type { ChatLanguage } from "./chat-languages";

const intentSchema = z.object({
  intent: z.string(),
  confidence: z.number(),
  related_transaction_hint: z.string().optional(),
  suggested_actions: z.array(z.string()),
});

export type ClassifyIntentResult = z.infer<typeof intentSchema> & { usage: TokenUsageSlice | null };

export async function classifySupportIntent(input: {
  customerName: string;
  recentMessages: { role: string; content: string }[];
  romanUrdu: boolean;
  /** Resolved per-tenant or env (e.g. gpt-4o-mini). */
  model?: string;
}): Promise<ClassifyIntentResult> {
  const openai = getOpenAI();
  const model = input.model?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const sys = `You are Raabta AI, a Pakistani banking support orchestration assistant.
Classify the customer's intent for operations dashboard routing.
Intents examples: suspicious_transaction, card_block, raast_issue, fee_policy_faq, general.
Return JSON only with keys: intent, confidence (0-1), related_transaction_hint (optional short text), suggested_actions (array of short action ids like block_card, create_complaint, escalate, resolve, kb_answer).`;

  const user = JSON.stringify({
    customerName: input.customerName,
    romanUrduPreferred: input.romanUrdu,
    transcript: input.recentMessages,
  });

  const res = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const usage: TokenUsageSlice | null = res.usage ? sliceFromCompletionUsage(res.usage) : null;

  const raw = res.choices[0]?.message?.content ?? "{}";
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = {};
  }
  const parsed = intentSchema.safeParse(json);
  if (!parsed.success) {
    return {
      intent: "general",
      confidence: 0.4,
      suggested_actions: ["kb_answer", "escalate"],
      usage,
    };
  }
  return { ...parsed.data, usage };
}

export type ConversationReplyPipelineInput = {
  customerName: string;
  messages: { role: string; content: string }[];
  kbContext: string;
  language: ChatLanguage;
  /** When language is Urdu, prefer Roman Urdu (Latin) vs Arabic script. */
  romanUrdu: boolean;
  /** From tenant-defined ai_agents — shapes tone and guardrails. */
  agentName?: string;
  agentInstructions?: string;
  model?: string;
};

function buildConversationReplyMessages(input: ConversationReplyPipelineInput): {
  model: string;
  messages: ChatCompletionMessageParam[];
} {
  const model = input.model?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const romanUr = input.romanUrdu && input.language === "ur";
  const langLine = languageInstruction(input.language, romanUr);
  const strictLine = strictOutputLanguageLine(input.language, romanUr);
  const kbBridge = `Knowledge-base excerpts are often written only in English. That is expected: use them as the source of truth for facts and policies, then explain to the customer entirely in the required output language—translate and localize (including numbers, limits, and product names where a local term exists). Do not paste long English paragraphs into non-English replies; every explanatory sentence must be in the required language.`;

  const instr = input.agentInstructions?.trim() ?? "";
  const persona = instr
    ? `\n\nYou are the tenant-configured agent${input.agentName ? ` "${input.agentName}"` : ""}. Follow these instructions in addition to the rules above:\n${instr}`
    : "";

  const sys = `You are Raabta AI helping bank support. ${langLine}
${kbBridge}
Ground answers in the knowledge excerpts when relevant. Explain policies clearly. Stay professional. If escalation is needed, say you are creating a case.${persona}`;

  const user = `Customer: ${input.customerName}\nKnowledge excerpts (may be English only):\n${input.kbContext || "(none)"}\n\nConversation thread:\n${input.messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")}\n\n${strictLine}\n\nDraft the next assistant message: facts from excerpts above, wording only in the required language.`;

  return {
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  };
}

export async function generateConversationReply(
  input: ConversationReplyPipelineInput
): Promise<{ reply: string; usage: TokenUsageSlice | null }> {
  const openai = getOpenAI();
  const { model, messages } = buildConversationReplyMessages(input);
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.4,
    messages,
  });
  const usage: TokenUsageSlice | null = res.usage ? sliceFromCompletionUsage(res.usage) : null;
  return {
    reply: res.choices[0]?.message?.content?.trim() ?? "",
    usage,
  };
}

/** Stream assistant tokens; same prompt as `generateConversationReply`. */
export async function streamConversationReply(
  input: ConversationReplyPipelineInput & { onDelta: (chunk: string) => void }
): Promise<{ reply: string; usage: TokenUsageSlice | null }> {
  const { onDelta, ...rest } = input;
  const openai = getOpenAI();
  const { model, messages } = buildConversationReplyMessages(rest);
  const stream = await openai.chat.completions.create({
    model,
    temperature: 0.4,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  });
  let reply = "";
  let usage: TokenUsageSlice | null = null;
  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = sliceFromCompletionUsage(chunk.usage);
    }
    const piece = chunk.choices[0]?.delta?.content;
    if (piece) {
      reply += piece;
      onDelta(piece);
    }
  }
  return { reply: reply.trim(), usage };
}

export async function generateHandoffSummary(input: {
  context: string;
  model?: string;
}): Promise<{ text: string; usage: TokenUsageSlice | null }> {
  const openai = getOpenAI();
  const model = input.model?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "Summarize for a human bank agent: facts, risk, recommended next steps. Bullet list, max 120 words.",
      },
      { role: "user", content: input.context },
    ],
  });
  const usage: TokenUsageSlice | null = res.usage ? sliceFromCompletionUsage(res.usage) : null;
  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    usage,
  };
}

export async function suggestAgentReply(input: {
  summary: string;
  thread: string;
  model?: string;
}): Promise<{ text: string; usage: TokenUsageSlice | null }> {
  const openai = getOpenAI();
  const model = input.model?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content:
          "Draft a professional reply the human agent can send to the customer. Short, empathetic, compliant tone.",
      },
      { role: "user", content: `Summary:\n${input.summary}\n\nThread:\n${input.thread}` },
    ],
  });
  const usage: TokenUsageSlice | null = res.usage ? sliceFromCompletionUsage(res.usage) : null;
  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    usage,
  };
}
