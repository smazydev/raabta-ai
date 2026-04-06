import { createServiceRoleClient } from "@/lib/supabase/admin";

export type BootstrapTenantResult = {
  tenantId: string;
  userId: string;
  slug: string;
};

/**
 * Creates a tenant, default settings row, app_users row (bcrypt), and admin profile.
 * Caller must enforce authorization (bootstrap secret / CLI only).
 */
export async function bootstrapTenant(input: {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
  adminDisplayName?: string;
}): Promise<BootstrapTenantResult> {
  const admin = createServiceRoleClient();
  const slug = input.slug.trim().toLowerCase().replace(/\s+/g, "-");

  const { data: existing } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (existing) {
    throw new Error(`Tenant slug already exists: ${slug}`);
  }

  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .insert({ name: input.name.trim(), slug })
    .select("id")
    .single();
  if (tErr || !tenant) throw new Error(tErr?.message ?? "Failed to create tenant");

  const tenantId = tenant.id as string;

  const { error: sErr } = await admin.from("settings").insert({
    tenant_id: tenantId,
    app_name: input.name.trim(),
    channels_enabled: {
      web_chat: true,
      app_chat: true,
      voice: true,
      agent_assist: true,
    },
    ai_toggles: { auto_reply: true, summaries: true },
    escalation_threshold: 3,
    roman_urdu_support: true,
    updated_at: new Date().toISOString(),
    provider_profile: {
      deployment_region: "",
      data_residency_note: "",
      default_openai_model: "",
      audit_export_webhook_url: "",
      live_events_webhook_url: "",
    },
  });
  if (sErr) throw new Error(sErr.message);

  await admin.from("tenant_billing").upsert(
    {
      tenant_id: tenantId,
      credit_balance: 500_000,
      included_credits_monthly: 500_000,
      payg_enabled: true,
      base_platform_fee_usd: 299,
      credits_per_usd_payg: 5000,
    },
    { onConflict: "tenant_id" }
  );

  const { data: created } = await admin.auth.admin.createUser({
    email: input.adminEmail.trim().toLowerCase(),
    password: input.adminPassword,
    email_confirm: true,
    user_metadata: { display_name: input.adminDisplayName ?? "Admin" },
  });
  if (!created.user) throw new Error("Failed to create admin user");

  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenantId,
    role: "admin",
    display_name: input.adminDisplayName ?? "Admin",
  });
  if (pErr) throw new Error(pErr.message);

  return { tenantId, userId: created.user.id, slug };
}
