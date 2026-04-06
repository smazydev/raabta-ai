import { createServiceRoleClient } from "@/lib/supabase/admin";

type UsageInput = {
  tenantId: string;
  eventType: string;
  quantity?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
};

/** Best-effort metering; never throws to callers. */
export async function recordUsageEvent(input: UsageInput): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    await admin.from("usage_events").insert({
      tenant_id: input.tenantId,
      event_type: input.eventType,
      quantity: input.quantity ?? 1,
      unit: input.unit ?? "count",
      metadata: input.metadata ?? {},
    });
  } catch (e) {
    console.error("recordUsageEvent", e);
  }
}

type AuditInput = {
  tenantId: string;
  source: string;
  action: string;
  actorLabel?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
};

async function postAuditExportWebhook(tenantId: string, envelope: Record<string, unknown>): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin
      .from("settings")
      .select("provider_profile")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const pp = (data?.provider_profile as Record<string, unknown> | null) ?? {};
    const url = typeof pp.audit_export_webhook_url === "string" ? pp.audit_export_webhook_url.trim() : "";
    if (!url || !/^https?:\/\//i.test(url)) return;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Raabta-AuditExport/1" },
        body: JSON.stringify(envelope),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("postAuditExportWebhook", e);
  }
}

export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { data: row, error } = await admin
      .from("audit_events")
      .insert({
        tenant_id: input.tenantId,
        source: input.source,
        action: input.action,
        actor_label: input.actorLabel ?? null,
        resource_type: input.resourceType ?? null,
        resource_id: input.resourceId ?? null,
        payload: input.payload ?? {},
      })
      .select("id")
      .single();
    if (error) throw error;
    void postAuditExportWebhook(input.tenantId, {
      type: "audit_event",
      audit_event_id: row && typeof (row as { id?: string }).id === "string" ? (row as { id: string }).id : null,
      tenant_id: input.tenantId,
      source: input.source,
      action: input.action,
      actor_label: input.actorLabel ?? null,
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      payload: input.payload ?? {},
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("recordAuditEvent", e);
  }
}
