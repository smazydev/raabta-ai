/**
 * OpenAI list prices (USD per 1M tokens) — update when OpenAI changes pricing.
 * Source: GPT-5.4 family sheet (input / cached input / output).
 */

export type ModelUsdPer1M = {
  input: number;
  cachedInput: number;
  output: number;
};

/** Exact model ids and aliases → USD per 1M tokens. */
const TABLE: Record<string, ModelUsdPer1M> = {
  // GPT-5.4 — "most capable"
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15.0 },
  "gpt-5.4-2025-12-01": { input: 2.5, cachedInput: 0.25, output: 15.0 },
  // Mini
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-mini-2025-12-01": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  // Nano — high-volume / cheap
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-nano-2025-12-01": { input: 0.2, cachedInput: 0.02, output: 1.25 },
};

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

/**
 * Resolve published rates for a chat model id.
 * Returns null if unknown — caller should fall back to legacy token-based credits.
 */
export function openAiChatRatesForModel(model: string | null | undefined): ModelUsdPer1M | null {
  if (!model?.trim()) return null;
  const m = normalizeModelId(model);
  if (TABLE[m]) return TABLE[m];
  // Substring tiers (longer suffix first)
  if (m.includes("gpt-5.4") || m.includes("gpt-5-4")) {
    if (m.includes("nano")) return TABLE["gpt-5.4-nano"]!;
    if (m.includes("mini")) return TABLE["gpt-5.4-mini"]!;
    if (m.includes("5.4")) return TABLE["gpt-5.4"]!;
  }
  return null;
}

/**
 * Provider cost in USD for one chat completion (excludes your margin).
 */
export function openAiChatProviderCostUsd(
  rates: ModelUsdPer1M,
  promptTokens: number,
  completionTokens: number,
  cachedPromptTokens: number
): number {
  const p = Math.max(0, promptTokens);
  const c = Math.max(0, completionTokens);
  const cached = Math.min(Math.max(0, cachedPromptTokens), p);
  const uncached = p - cached;
  return (
    (uncached / 1_000_000) * rates.input +
    (cached / 1_000_000) * rates.cachedInput +
    (c / 1_000_000) * rates.output
  );
}
