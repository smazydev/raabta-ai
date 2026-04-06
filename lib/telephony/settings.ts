import type { Pool } from "pg";

export type TelephonySettings = {
  twilio_inbound_e164?: string;
  twilio_escalation_e164?: string;
};

export function parseTelephony(raw: unknown): TelephonySettings {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const inbound = typeof o.twilio_inbound_e164 === "string" ? o.twilio_inbound_e164.trim() : "";
  const esc = typeof o.twilio_escalation_e164 === "string" ? o.twilio_escalation_e164.trim() : "";
  return {
    ...(inbound ? { twilio_inbound_e164: inbound } : {}),
    ...(esc ? { twilio_escalation_e164: esc } : {}),
  };
}

/** Normalize Twilio To/From for comparison (trim; keep +). */
export function normalizeInboundE164(raw: string): string {
  const t = raw.trim().replace(/\s+/g, "");
  return t.startsWith("+") ? t : `+${t}`;
}

/**
 * Resolve tenant_id whose configured Twilio inbound number matches `toNumber` (e.g. Twilio "To").
 * Stored value may be with or without leading +; both are normalized before compare.
 */
export async function resolveTenantIdByTwilioTo(pool: Pool, toNumber: string): Promise<string | null> {
  const normalized = normalizeInboundE164(toNumber);
  const r = await pool.query<{ tenant_id: string }>(
    `
    SELECT tenant_id::text AS tenant_id
    FROM settings
    WHERE telephony->>'twilio_inbound_e164' IS NOT NULL
      AND btrim(telephony->>'twilio_inbound_e164') <> ''
      AND (
        CASE
          WHEN left(btrim(telephony->>'twilio_inbound_e164'), 1) = '+'
          THEN btrim(telephony->>'twilio_inbound_e164')
          ELSE '+' || btrim(telephony->>'twilio_inbound_e164')
        END
      ) = $1
    LIMIT 1
    `,
    [normalized]
  );
  return r.rows[0]?.tenant_id ?? null;
}

export async function getTelephonyForTenant(
  pool: Pool,
  tenantId: string
): Promise<TelephonySettings> {
  const r = await pool.query<{ telephony: unknown }>(
    `SELECT telephony FROM settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  return parseTelephony(r.rows[0]?.telephony);
}
