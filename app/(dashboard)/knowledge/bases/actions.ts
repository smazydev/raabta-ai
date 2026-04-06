"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createKnowledgeBaseAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) throw new Error("Name is required");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
  if (!profile?.tenant_id || typeof profile.tenant_id !== "string") throw new Error("No tenant");

  const { error } = await supabase.from("knowledge_bases").insert({
    tenant_id: profile.tenant_id,
    name,
    description,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message || "Could not create knowledge base");

  revalidatePath("/knowledge/bases");
  revalidatePath("/knowledge");
  revalidatePath("/platform/agents");
}
