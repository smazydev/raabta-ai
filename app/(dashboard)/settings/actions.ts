"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPool } from "@/lib/db/pool";
import { generateRawApiKey, hashApiKeySecret, keyPrefixFromRaw } from "@/lib/platform/api-key";
import { getSessionTenant } from "@/lib/session";
import { normalizeInboundE164 } from "@/lib/telephony/settings";
import { addTenantCredits, ensureTenantBillingRow, getTenantBillingWallet } from "@/lib/billing/credits";

export async function updateSettingsAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id) throw new Error("No tenant");
  if (profile.role !== "admin") throw new Error("Admin only");

  const appName = String(formData.get("app_name") ?? "Raabta AI");
  const roman = formData.get("roman_urdu") === "on";
  const threshold = Number(formData.get("escalation_threshold") ?? 3);

  const { data: currentSettings } = await supabase
    .from("settings")
    .select("ai_toggles, provider_profile, telephony")
    .eq("tenant_id", profile.tenant_id)
    .single();
  const aiToggles = ((currentSettings?.ai_toggles as Record<string, unknown> | null) ?? {}) as Record<
    string,
    unknown
  >;
  const prevProfile =
    (currentSettings?.provider_profile as Record<string, unknown> | null | undefined) ?? {};

  const liveSecretNew = String(formData.get("pp_live_webhook_secret") ?? "").trim();
  const liveSecretClear = formData.get("pp_live_webhook_secret_clear") === "on";
  const prevSecret =
    typeof prevProfile.live_events_webhook_secret === "string" ? prevProfile.live_events_webhook_secret : "";
  const nextLiveSecret = liveSecretClear ? "" : liveSecretNew || prevSecret;

  const provider_profile: Record<string, unknown> = {
    ...prevProfile,
    default_openai_model: String(formData.get("pp_model") ?? "").trim(),
    deployment_region: String(formData.get("pp_region") ?? "").trim(),
    data_residency_note: String(formData.get("pp_residency") ?? "").trim(),
    audit_export_webhook_url: String(formData.get("pp_webhook") ?? "").trim(),
    live_events_webhook_url: String(formData.get("pp_live_webhook") ?? "").trim(),
    sla_runbook_url: String(formData.get("pp_runbook") ?? "").trim(),
  };
  if (liveSecretClear || liveSecretNew) {
    provider_profile.live_events_webhook_secret = nextLiveSecret;
  }

  const prevTelephony = ((currentSettings?.telephony as Record<string, unknown> | null) ?? {}) as Record<
    string,
    unknown
  >;
  const twInbound = String(formData.get("twilio_inbound_e164") ?? "").trim();
  const twEscalation = String(formData.get("twilio_escalation_e164") ?? "").trim();
  const telephony: Record<string, unknown> = { ...prevTelephony };
  if (twInbound) telephony.twilio_inbound_e164 = normalizeInboundE164(twInbound);
  else delete telephony.twilio_inbound_e164;
  if (twEscalation) telephony.twilio_escalation_e164 = normalizeInboundE164(twEscalation);
  else delete telephony.twilio_escalation_e164;

  const nextAiToggles: Record<string, unknown> = {
    ...aiToggles,
    auto_reply: formData.get("ai_auto_reply") === "on",
    summaries: formData.get("ai_summaries") === "on",
    assistant_copilot: formData.get("ai_assistant_copilot") === "on",
    embeddings_enabled: formData.get("ai_embeddings") === "on",
    tts_enabled: formData.get("ai_tts") === "on",
  };

  await supabase
    .from("settings")
    .update({
      app_name: appName,
      roman_urdu_support: roman,
      escalation_threshold: Number.isFinite(threshold) ? threshold : 3,
      telephony,
      ai_toggles: nextAiToggles,
      provider_profile,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", profile.tenant_id);

  revalidatePath("/settings");
}

export async function createApiKeyAction(
  formData: FormData
): Promise<{ ok: true; secret: string; prefix: string } | { error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized" };
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();
    if (!profile?.tenant_id || profile.role !== "admin") return { error: "Admin only" };

    const name = String(formData.get("name") ?? "").trim() || "API key";
    const raw = generateRawApiKey();
    const secret_hash = hashApiKeySecret(raw);
    const key_prefix = keyPrefixFromRaw(raw);

    const { error } = await supabase.from("tenant_api_keys").insert({
      tenant_id: profile.tenant_id,
      name,
      key_prefix,
      secret_hash,
      scopes: ["events:write", "metrics:read", "audit:read", "conversations:write"],
    });
    if (error) return { error: error.message };

    revalidatePath("/settings");
    return { ok: true, secret: raw, prefix: key_prefix };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<{ ok: true } | { error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized" };
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();
    if (!profile?.tenant_id || profile.role !== "admin") return { error: "Admin only" };

    const id = String(formData.get("id") ?? "").trim();
    if (!id) return { error: "Missing id" };

    const { error } = await supabase
      .from("tenant_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);

    if (error) return { error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function updateTenantBillingPlanAction(formData: FormData) {
  const session = await getSessionTenant();
  if (!session || session.role !== "admin") throw new Error("Admin only");
  await ensureTenantBillingRow(session.tenantId);
  const pool = getPool();
  const included = Number(formData.get("included_credits_monthly") ?? 0);
  const payg = formData.get("payg_enabled") === "on";
  const maxDebtRaw = String(formData.get("payg_max_debt") ?? "").trim();
  const maxDebt = maxDebtRaw === "" ? null : Number(maxDebtRaw);
  const baseFee = Number(formData.get("base_platform_fee_usd") ?? 299);
  const cpu = Number(formData.get("credits_per_usd_payg") ?? 5000);

  await pool.query(
    `UPDATE public.tenant_billing SET
       included_credits_monthly = $2,
       payg_enabled = $3,
       payg_max_debt_credits = $4,
       base_platform_fee_usd = $5,
       credits_per_usd_payg = $6,
       updated_at = timezone('utc', now())
     WHERE tenant_id = $1::uuid`,
    [
      session.tenantId,
      Number.isFinite(included) && included >= 0 ? included : 100000,
      payg,
      maxDebt != null && Number.isFinite(maxDebt) && maxDebt >= 0 ? maxDebt : null,
      Number.isFinite(baseFee) && baseFee >= 0 ? baseFee : 0,
      Number.isFinite(cpu) && cpu > 0 ? cpu : 5000,
    ]
  );
  revalidatePath("/settings");
}

export async function purchasePaygCreditsAction(
  formData: FormData
): Promise<{ ok: true; credits_added: number; new_balance: number } | { error: string }> {
  try {
    const session = await getSessionTenant();
    if (!session || session.role !== "admin") return { error: "Admin only" };
    const usd = Number(formData.get("purchase_usd") ?? 0);
    if (!Number.isFinite(usd) || usd <= 0) return { error: "Enter a positive USD amount" };
    await ensureTenantBillingRow(session.tenantId);
    const w = await getTenantBillingWallet(session.tenantId);
    const rate = w ? Number(w.credits_per_usd_payg) : 5000;
    const mult = Number.isFinite(rate) && rate > 0 ? rate : 5000;
    const credits = Math.floor(usd * mult);
    if (credits <= 0) return { error: "Credits amount too small" };
    const { newBalance } = await addTenantCredits(session.tenantId, credits, "payg_purchase_simulation", {
      usd,
      credits_per_usd: mult,
    });
    revalidatePath("/settings");
    return { ok: true, credits_added: credits, new_balance: newBalance };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}
