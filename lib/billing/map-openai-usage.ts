import type { CompletionUsage } from "openai/resources/completions";
import type { TokenUsageSlice } from "./pricing";

/** Map OpenAI chat completion usage → billing slice (incl. cached prompt tokens when present). */
export function sliceFromCompletionUsage(u: CompletionUsage | undefined | null): TokenUsageSlice {
  if (!u) {
    return {};
  }
  const cached = u.prompt_tokens_details?.cached_tokens;
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
    cached_prompt_tokens: cached != null && cached > 0 ? cached : undefined,
  };
}
