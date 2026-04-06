/**
 * Credits from OpenAI usage.
 *
 * When the chat model has a known price sheet (GPT-5.4 family), we bill from:
 *   provider_usd = f(input, cached_input, output) × OpenAI list $/1M
 *   retail_usd   = provider_usd × RAABTA_OPENAI_COST_MARGIN (default 2)
 *   credits      = ceil(retail_usd × RAABTA_RETAIL_CREDITS_PER_USD), min 1
 *
 * Unknown models fall back to token density: ceil(total_tokens / RAABTA_CREDITS_TOKENS_PER_CREDIT).
 */

import { openAiChatProviderCostUsd, openAiChatRatesForModel } from "./openai-provider-rates";

function tokensPerCredit(): number {
  const n = Number(process.env.RAABTA_CREDITS_TOKENS_PER_CREDIT ?? 1000);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

/** Margin on top of OpenAI provider cost (2 = ~100% markup). */
function costMargin(): number {
  const n = Number(process.env.RAABTA_OPENAI_COST_MARGIN ?? 2);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

/**
 * How many credits equal $1 of *retail* metered AI cost (after margin).
 * Default 5000 matches typical PAYG "credits per $1" in tenant settings.
 */
function retailCreditsPerUsd(): number {
  const n = Number(process.env.RAABTA_RETAIL_CREDITS_PER_USD ?? 5000);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

function isOpenAiCostBasedBillingEnabled(): boolean {
  const v = process.env.RAABTA_OPENAI_COST_BASED_BILLING?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

export type TokenUsageSlice = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  /** Prompt tokens billed at cached-input $/1M (from usage.prompt_tokens_details.cached_tokens). */
  cached_prompt_tokens?: number | null;
};

function creditsFromLegacyTokenDensity(usage: TokenUsageSlice | null | undefined): number {
  if (!usage) return 1;
  const total =
    typeof usage.total_tokens === "number" && usage.total_tokens > 0
      ? usage.total_tokens
      : Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0);
  if (total <= 0) return 1;
  const per = tokensPerCredit();
  return Math.max(1, Math.ceil(total / per));
}

function cachedFromUsage(usage: TokenUsageSlice | null | undefined): number {
  if (usage?.cached_prompt_tokens != null && Number.isFinite(Number(usage.cached_prompt_tokens))) {
    return Math.max(0, Number(usage.cached_prompt_tokens));
  }
  return 0;
}

/** Credits for one chat completion, using model rates when available. */
export function creditsFromChatUsageForBilling(
  chatModel: string | null | undefined,
  usage: TokenUsageSlice | null | undefined
): number {
  if (!isOpenAiCostBasedBillingEnabled()) {
    return creditsFromLegacyTokenDensity(usage);
  }
  const rates = openAiChatRatesForModel(chatModel ?? undefined);
  if (!rates || !usage) {
    return creditsFromLegacyTokenDensity(usage);
  }

  const prompt = Number(usage.prompt_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? 0);
  if (prompt <= 0 && completion <= 0) return 1;

  const cachedRaw = cachedFromUsage(usage);
  const cached = Math.min(cachedRaw, prompt);
  const providerUsd = openAiChatProviderCostUsd(rates, prompt, completion, cached);
  const retailUsd = providerUsd * costMargin();
  const credits = Math.ceil(retailUsd * retailCreditsPerUsd());
  return Math.max(1, credits);
}

/** Sum provider USD across many completion usages (same model), then one margin + credit conversion. */
export function creditsFromAggregatedChatUsagesForBilling(
  chatModel: string | null | undefined,
  usages: (TokenUsageSlice | null | undefined)[]
): number {
  if (!isOpenAiCostBasedBillingEnabled()) {
    const agg = aggregateChatUsage(usages);
    return creditsFromLegacyTokenDensity(agg);
  }
  const rates = openAiChatRatesForModel(chatModel ?? undefined);
  if (!rates) {
    const agg = aggregateChatUsage(usages);
    return creditsFromLegacyTokenDensity(agg);
  }

  let providerUsd = 0;
  for (const u of usages) {
    if (!u) continue;
    const prompt = Number(u.prompt_tokens ?? 0);
    const completion = Number(u.completion_tokens ?? 0);
    if (prompt <= 0 && completion <= 0) continue;
    const cached = Math.min(cachedFromUsage(u), prompt);
    providerUsd += openAiChatProviderCostUsd(rates, prompt, completion, cached);
  }
  if (providerUsd <= 0) return 1;
  const retailUsd = providerUsd * costMargin();
  const credits = Math.ceil(retailUsd * retailCreditsPerUsd());
  return Math.max(1, credits);
}

export function creditsFromChatUsage(usage: TokenUsageSlice | null | undefined): number {
  return creditsFromLegacyTokenDensity(usage);
}

export function creditsFromEmbeddingUsage(usage: { prompt_tokens?: number; total_tokens?: number } | null | undefined): number {
  if (!usage) return 1;
  const t = Number(usage.total_tokens ?? usage.prompt_tokens ?? 0);
  if (t <= 0) return 1;
  const per = tokensPerCredit();
  return Math.max(1, Math.ceil(t / per));
}

export function creditsFromTtsInput(charCount: number): number {
  const base = Math.max(1, Math.ceil(charCount / 400));
  const mult = Number(process.env.RAABTA_CREDITS_TTS_MULTIPLIER ?? 1);
  return Math.max(1, Math.ceil(base * (Number.isFinite(mult) && mult > 0 ? mult : 1)));
}

export function minPreflightChatCredits(): number {
  return 1;
}

export function aggregateChatUsage(
  parts: (TokenUsageSlice | null | undefined)[]
): { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_prompt_tokens: number } {
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let total_tokens = 0;
  let cached_prompt_tokens = 0;
  for (const u of parts) {
    if (!u) continue;
    prompt_tokens += Number(u.prompt_tokens ?? 0);
    completion_tokens += Number(u.completion_tokens ?? 0);
    total_tokens += Number(
      u.total_tokens ?? (Number(u.prompt_tokens ?? 0) + Number(u.completion_tokens ?? 0))
    );
    cached_prompt_tokens += cachedFromUsage(u);
  }
  if (total_tokens <= 0) total_tokens = prompt_tokens + completion_tokens;
  return { prompt_tokens, completion_tokens, total_tokens, cached_prompt_tokens };
}

export function creditsFromAggregatedChat(agg: ReturnType<typeof aggregateChatUsage>): number {
  return creditsFromLegacyTokenDensity(agg);
}

/** Telemetry / ledger metadata for a single completion charge. */
export function chatChargeMetadata(
  chatModel: string | null | undefined,
  usage: TokenUsageSlice | null | undefined,
  creditsCharged: number
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: chatModel ?? null,
    credits_charged: creditsCharged,
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    total_tokens: usage?.total_tokens ?? null,
    cached_prompt_tokens: usage?.cached_prompt_tokens ?? null,
  };
  if (!isOpenAiCostBasedBillingEnabled()) {
    return { ...base, billing_mode: "legacy_token_density" };
  }
  const rates = openAiChatRatesForModel(chatModel ?? undefined);
  if (!rates || !usage) {
    return { ...base, billing_mode: "legacy_unknown_model" };
  }
  const p = Number(usage.prompt_tokens ?? 0);
  const c = Number(usage.completion_tokens ?? 0);
  const cached = Math.min(cachedFromUsage(usage), p);
  const providerUsd = openAiChatProviderCostUsd(rates, p, c, cached);
  return {
    ...base,
    billing_mode: "openai_list_cost",
    provider_cost_usd: providerUsd,
    retail_usd_estimate: providerUsd * costMargin(),
    cost_margin: costMargin(),
    retail_credits_per_usd: retailCreditsPerUsd(),
  };
}

/** Telemetry for one aggregated assistant / frontdesk turn. */
export function aggregatedChatChargeMetadata(
  chatModel: string | null | undefined,
  usages: (TokenUsageSlice | null | undefined)[],
  creditsCharged: number
): Record<string, unknown> {
  const agg = aggregateChatUsage(usages);
  const base: Record<string, unknown> = {
    model: chatModel ?? null,
    credits_charged: creditsCharged,
    prompt_tokens: agg.prompt_tokens,
    completion_tokens: agg.completion_tokens,
    total_tokens: agg.total_tokens,
    cached_prompt_tokens: agg.cached_prompt_tokens,
    completion_rounds: usages.filter(Boolean).length,
  };
  if (!isOpenAiCostBasedBillingEnabled()) {
    return { ...base, billing_mode: "legacy_token_density" };
  }
  const rates = openAiChatRatesForModel(chatModel ?? undefined);
  if (!rates) {
    return { ...base, billing_mode: "legacy_unknown_model" };
  }
  let providerUsd = 0;
  for (const u of usages) {
    if (!u) continue;
    const p = Number(u.prompt_tokens ?? 0);
    const c = Number(u.completion_tokens ?? 0);
    if (p <= 0 && c <= 0) continue;
    const cached = Math.min(cachedFromUsage(u), p);
    providerUsd += openAiChatProviderCostUsd(rates, p, c, cached);
  }
  return {
    ...base,
    billing_mode: "openai_list_cost",
    provider_cost_usd: providerUsd,
    retail_usd_estimate: providerUsd * costMargin(),
    cost_margin: costMargin(),
    retail_credits_per_usd: retailCreditsPerUsd(),
  };
}
