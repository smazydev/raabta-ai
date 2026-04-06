import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getOpenAI } from "@/lib/ai/openai";
import { sliceFromCompletionUsage } from "@/lib/billing/map-openai-usage";
import type { TokenUsageSlice } from "@/lib/billing/pricing";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tool-schemas";
import { executeAssistantTool, type ToolContext } from "@/lib/assistant/execute-tool";
import type { AppDbClient } from "@/lib/db/types";

const MAX_TOOL_ROUNDS = 8;

export async function runAssistantChat(input: {
  supabase: AppDbClient;
  tenantId: string;
  userId: string;
  messages: ChatCompletionMessageParam[];
  /** Per-tenant / env chat model */
  openAiChatModel: string;
  systemPrompt: string;
  allowedKnowledgeArticleIds: string[] | undefined;
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
    const res = await openai.chat.completions.create({
      model,
      messages: msgs,
      tools: ASSISTANT_TOOLS,
      tool_choice: "auto",
      temperature: 0.25,
    });

    if (res.usage) {
      chatUsages.push(sliceFromCompletionUsage(res.usage));
    }

    const choice = res.choices[0]?.message;
    if (!choice) {
      return { reply: "No response from the model.", artifactMarkdown, chatUsages };
    }

    if (choice.tool_calls?.length) {
      msgs.push({
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: choice.tool_calls,
      });

      for (const tc of choice.tool_calls) {
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
      reply: choice.content?.trim() || "(empty reply)",
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
