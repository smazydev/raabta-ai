import { createHash, randomBytes } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/admin";

const PREFIX = "rk_live_";

export function generateRawApiKey(): string {
  return `${PREFIX}${randomBytes(24).toString("hex")}`;
}

export function hashApiKeySecret(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function keyPrefixFromRaw(raw: string): string {
  return raw.length >= 16 ? raw.slice(0, 16) : raw;
}

export type ResolvedApiKey = {
  keyId: string;
  tenantId: string;
  scopes: string[];
};

export async function resolveBearerApiKey(authorization: string | null): Promise<ResolvedApiKey | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const raw = authorization.slice(7).trim();
  if (!raw.startsWith(PREFIX) || raw.length < PREFIX.length + 16) return null;

  const hash = hashApiKeySecret(raw);
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("tenant_api_keys")
    .select("id, tenant_id, scopes, revoked_at")
    .eq("secret_hash", hash)
    .maybeSingle();

  if (error || !data || data.revoked_at) return null;

  await admin
    .from("tenant_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id as string);

  return {
    keyId: data.id as string,
    tenantId: data.tenant_id as string,
    scopes: Array.isArray(data.scopes) ? (data.scopes as string[]) : [],
  };
}

export function scopeAllows(scopes: string[], required: string): boolean {
  if (scopes.includes("*")) return true;
  return scopes.includes(required);
}
