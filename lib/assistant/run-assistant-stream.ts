import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import { getOpenAI } from "@/lib/ai/openai";
import { sliceFromCompletionUsage } from "@/lib/billing/map-openai-usage";
import type { TokenUsageSlice } from "@/lib/billing/pricing";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tool-schemas";
import { executeAssistantTool, type ToolContext } from "@/lib/assistant/execute-tool";
import type { AppDbClient } from "@/lib/db/types";

const MAX_TOOL_ROUNDS = 8;

type ToolCallAcc = { id: string; name: string; arguments: string };

function mergeToolCallDeltas(
  byIndex: Map<number, ToolCallAcc>,
  deltas: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }> | null | undefined
) {
  if (!deltas?.length) return;
  for (const d of deltas) {
    const idx = d.index ?? 0;
    let acc = byIndex.get(idx);
    if (!acc) {
      acc = { id: "", name: "", arguments: "" };
      byIndex.set(idx, acc);
    }
    if (d.id) acc.id = d.id;
    if (d.function?.name) acc.name += d.function.name;
    if (d.function?.arguments) acc.arguments += d.function.arguments;
  }
}

function toolCallsFromAcc(byIndex: Map<number, ToolCallAcc>): ChatCompletionMessageToolCall[] {
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id || `call_${Math.random().toString(36).slice(2)}`,
      type: "function" as const,
      function: { name: v.name, arguments: v.arguments || "{}" },
    }));
}

/**
 * Same tool loop as `runAssistantChat`, but streams assistant **text** tokens from the model.
 * Tool rounds emit `onToolRoundStart` instead of text until the next model pass.
 */
export async function runAssistantChatStreamed(input: {
  supabase: AppDbClient;
  tenantId: string;
  userId: string;
  messages: ChatCompletionMessageParam[];
  openAiChatModel: string;
  systemPrompt: string;
  allowedKnowledgeArticleIds: string[] | undefined;
  onTextDelta: (chunk: string) => void;
  onToolRoundStart?: () => void;
}): Promise<{ reply: string; artifactMarkdown?: string; chatUsages: TokenUsageSlice[] }> {
  const openai = getOpenAI();
  const model = input.openAiChatModel.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const chatUsages: TokenUsageSlice[] = [];
  const ctx: ToolContext = {
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    openAiChatModel: model,
    allowedKnowledgeArticleIds: input.allowedKnowledgeArticleIds,
    accumulateUsage: (u) => {
      if (u) chatUsages.push(u);
    },
  };

  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: input.systemPrompt },
    ...input.messages,
  ];

  let artifactMarkdown: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await openai.chat.completions.create({
      model,
      messages: msgs,
      tools: ASSISTANT_TOOLS,
      tool_choice: "auto",
      temperature: 0.25,
      stream: true,
      stream_options: { include_usage: true },
    });

    const byIndex = new Map<number, ToolCallAcc>();
    let content = "";
    let finishReason: string | null | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        const u = sliceFromCompletionUsage(chunk.usage);
        if (u) chatUsages.push(u);
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      finishReason = choice.finish_reason ?? finishReason;
      const delta = choice.delta;
      if (delta?.content) {
        content += delta.content;
        input.onTextDelta(delta.content);
      }
      mergeToolCallDeltas(byIndex, delta?.tool_calls);
    }

    const hasTools = finishReason === "tool_calls" && byIndex.size > 0;
    if (hasTools) {
      input.onToolRoundStart?.();
      const toolCalls = toolCallsFromAcc(byIndex);
      msgs.push({
        role: "assistant",
        content: content.length ? content : null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const name = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const out = await executeAssistantTool(ctx, name, args);
        if (out.artifactMarkdown) artifactMarkdown = out.artifactMarkdown;
        msgs.push({
          role: "tool",
          tool_call_id: tc.id,
          content: out.content,
        });
      }
      continue;
    }

    return {
      reply: content.trim() || "(empty reply)",
      artifactMarkdown,
      chatUsages,
    };
  }

  return {
    reply: "This request needed too many steps. Please narrow your question or split it into parts.",
    artifactMarkdown,
    chatUsages,
  };
}
