import { getPool } from "@/lib/db/pool";
import { recordUsageEvent } from "@/lib/platform/telemetry";
import {
  aggregatedChatChargeMetadata,
  chatChargeMetadata,
  creditsFromAggregatedChatUsagesForBilling,
  creditsFromChatUsageForBilling,
  creditsFromEmbeddingUsage,
  creditsFromTtsInput,
  type TokenUsageSlice,
} from "./pricing";
import { BillingInsufficientCreditsError, BillingPaygDebtCapError } from "./errors";

export type TenantBillingWallet = {
  tenant_id: string;
  credit_balance: string;
  included_credits_monthly: string;
  billing_period_months: number;
  billing_period_start: string;
  billing_period_end: string;
  payg_enabled: boolean;
  payg_max_debt_credits: string | null;
  base_platform_fee_usd: string;
  credits_per_usd_payg: string;
  updated_at: string;
};

type ConsumeJson = {
  ok: boolean;
  new_balance?: number;
  error?: string;
  balance?: number;
  required?: number;
  skipped?: boolean;
  ledger_id?: string;
};

function parseConsumeResult(row: unknown): ConsumeJson {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    return row as ConsumeJson;
  }
  if (typeof row === "string") {
    try {
      return JSON.parse(row) as ConsumeJson;
    } catch {
      return { ok: false, error: "parse_failed" };
    }
  }
  return { ok: false, error: "empty" };
}

export async function getTenantBillingWallet(tenantId: string): Promise<TenantBillingWallet | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT tenant_id, credit_balance, included_credits_monthly, billing_period_months,
            billing_period_start, billing_period_end, payg_enabled, payg_max_debt_credits,
            base_platform_fee_usd, credits_per_usd_payg, updated_at
     FROM public.tenant_billing WHERE tenant_id = $1::uuid`,
    [tenantId]
  );
  const row = res.rows[0] as TenantBillingWallet | undefined;
  return row ?? null;
}

/** Ensure row exists (first touch grants defaults from table). */
export async function ensureTenantBillingRow(tenantId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO public.tenant_billing (tenant_id) VALUES ($1::uuid) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
}

export async function consumeTenantCredits(
  tenantId: string,
  credits: number,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<{ newBalance: number; ledgerId?: string }> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT public.billing_consume_credits($1::uuid, $2::numeric, $3::text, $4::jsonb) AS r`,
    [tenantId, credits, reason, JSON.stringify(metadata)]
  );
  const j = parseConsumeResult(res.rows[0]?.r);
  if (!j.ok) {
    const bal = Number(j.balance ?? 0);
    const req = Number(j.required ?? credits);
    if (j.error === "payg_debt_cap") {
      throw new BillingPaygDebtCapError(bal, req);
    }
    throw new BillingInsufficientCreditsError(bal, req);
  }
  void recordUsageEvent({
    tenantId,
    eventType: "billing.credits_consumed",
    quantity: credits,
    unit: "credits",
    metadata: { reason, ...metadata },
  });
  return { newBalance: Number(j.new_balance ?? 0), ledgerId: j.ledger_id };
}

export async function addTenantCredits(
  tenantId: string,
  credits: number,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<{ newBalance: number }> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT public.billing_add_credits($1::uuid, $2::numeric, $3::text, $4::jsonb) AS r`,
    [tenantId, credits, reason, JSON.stringify(metadata)]
  );
  const j = parseConsumeResult(res.rows[0]?.r);
  if (!j.ok) {
    throw new Error(j.error ?? "add_credits_failed");
  }
  void recordUsageEvent({
    tenantId,
    eventType: "billing.credits_added",
    quantity: credits,
    unit: "credits",
    metadata: { reason, ...metadata },
  });
  return { newBalance: Number(j.new_balance ?? 0) };
}

/**
 * When pay-as-you-go is disabled, block if balance is below minimum before calling OpenAI.
 * When enabled, spending can go negative up to payg_max_debt_credits (if set).
 */
export async function preflightAiCredits(tenantId: string, minCredits: number): Promise<void> {
  await ensureTenantBillingRow(tenantId);
  const w = await getTenantBillingWallet(tenantId);
  if (!w) return;
  if (w.payg_enabled) return;
  const bal = Number(w.credit_balance);
  if (bal < minCredits) {
    throw new BillingInsufficientCreditsError(bal, minCredits);
  }
}

export async function chargeAfterChatCompletion(
  tenantId: string,
  usage: TokenUsageSlice | null | undefined,
  reason: string,
  metadata: Record<string, unknown> = {},
  chatModel?: string | null
): Promise<void> {
  const credits = creditsFromChatUsageForBilling(chatModel, usage);
  const billingMeta = chatChargeMetadata(chatModel, usage, credits);
  await consumeTenantCredits(tenantId, credits, reason, {
    ...metadata,
    ...billingMeta,
  });
}

export async function chargeAfterEmbeddingCall(
  tenantId: string,
  usage: { prompt_tokens?: number; total_tokens?: number } | null | undefined,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const credits = creditsFromEmbeddingUsage(usage);
  await consumeTenantCredits(tenantId, credits, reason, {
    ...metadata,
    embedding_tokens: usage?.total_tokens ?? usage?.prompt_tokens ?? null,
    credits_charged: credits,
  });
}

export async function chargeAfterAggregatedChat(
  tenantId: string,
  usages: (TokenUsageSlice | null | undefined)[],
  reason: string,
  metadata: Record<string, unknown> = {},
  chatModel?: string | null
): Promise<void> {
  const credits = creditsFromAggregatedChatUsagesForBilling(chatModel, usages);
  const billingMeta = aggregatedChatChargeMetadata(chatModel, usages, credits);
  await consumeTenantCredits(tenantId, credits, reason, {
    ...metadata,
    ...billingMeta,
  });
}

export async function chargeTtsCredits(tenantId: string, charCount: number, metadata: Record<string, unknown> = {}) {
  const credits = creditsFromTtsInput(charCount);
  await consumeTenantCredits(tenantId, credits, "openai.tts", {
    ...metadata,
    char_count: charCount,
    credits_charged: credits,
  });
}
