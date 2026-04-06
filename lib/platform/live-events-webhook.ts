import { createHmac } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/** HMAC-SHA256 hex of the exact JSON body (UTF-8). Verify with header `X-Raabta-Signature: v1=<hex>`. */
export function signLiveEventWebhookBody(secret: string, bodyUtf8: string): string {
  return createHmac("sha256", secret).update(bodyUtf8, "utf8").digest("hex");
}

export type LiveEventWebhookPayload = {
  tenant_id: string;
  live_event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

/**
 * Best-effort POST to tenant-configured URL after a row is written to live_events.
 * Optional HMAC-SHA256 signing when live_events_webhook_secret is set in provider_profile.
 */
export function enqueueLiveEventWebhook(input: LiveEventWebhookPayload): void {
  void deliverLiveEventWebhook(input);
}

async function deliverLiveEventWebhook(input: LiveEventWebhookPayload): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin
      .from("settings")
      .select("provider_profile")
      .eq("tenant_id", input.tenant_id)
      .maybeSingle();
    const pp = (data?.provider_profile as Record<string, unknown> | null) ?? {};
    const urlRaw = typeof pp.live_events_webhook_url === "string" ? pp.live_events_webhook_url.trim() : "";
    if (!urlRaw || !/^https?:\/\//i.test(urlRaw)) return;

    const secret =
      typeof pp.live_events_webhook_secret === "string" ? pp.live_events_webhook_secret.trim() : "";
    const envelope = {
      type: "live_event" as const,
      ...input,
    };
    const body = JSON.stringify(envelope);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Raabta-LiveEvents/1",
    };
    if (secret) {
      headers["X-Raabta-Signature"] = `v1=${signLiveEventWebhookBody(secret, body)}`;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    try {
      await fetch(urlRaw, {
        method: "POST",
        headers,
        body,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("deliverLiveEventWebhook", e);
  }
}
