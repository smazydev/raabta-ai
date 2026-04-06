"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const CONNECTOR_TYPES = [
  "bank_core",
  "card_rail",
  "raast",
  "telephony",
  "ats",
  "ticketing",
  "siem",
  "custom_http",
] as const;

export async function upsertConnectorAction(formData: FormData) {
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
  if (!profile?.tenant_id || profile.role !== "admin") throw new Error("Admin only");

  const connector_type = String(formData.get("connector_type") ?? "").trim();
  const display_name = String(formData.get("display_name") ?? "").trim();
  const status = String(formData.get("status") ?? "sandbox").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const id = String(formData.get("id") ?? "").trim() || null;

  if (!CONNECTOR_TYPES.includes(connector_type as (typeof CONNECTOR_TYPES)[number])) {
    throw new Error("Invalid connector type");
  }
  if (!display_name) throw new Error("Display name required");

  if (id) {
    const { error } = await supabase
      .from("connectors")
      .update({
        display_name,
        status,
        notes,
        updated_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("connectors").insert({
      tenant_id: profile.tenant_id,
      connector_type,
      display_name,
      status,
      notes,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/integrations");
}

export async function deleteConnectorAction(formData: FormData) {
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
  if (!profile?.tenant_id || profile.role !== "admin") throw new Error("Admin only");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Missing id");

  const { error } = await supabase.from("connectors").delete().eq("id", id).eq("tenant_id", profile.tenant_id);
  if (error) throw new Error(error.message);
  revalidatePath("/integrations");
}
