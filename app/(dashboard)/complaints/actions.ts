"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id) throw new Error("No tenant");
  return { supabase, tenantId: profile.tenant_id as string, userId: user.id };
}

export async function addComplaintNoteAction(complaintId: string, body: string) {
  const { supabase, tenantId, userId } = await ctx();
  await supabase.from("complaint_notes").insert({
    tenant_id: tenantId,
    complaint_id: complaintId,
    author_id: userId,
    body,
  });
  revalidatePath("/complaints");
}

export async function updateComplaintStatusAction(
  complaintId: string,
  status: string
) {
  const { supabase, tenantId } = await ctx();
  await supabase
    .from("complaints")
    .update({
      status,
      updated_at: new Date().toISOString(),
      resolved_at: status === "resolved" || status === "closed" ? new Date().toISOString() : null,
    })
    .eq("id", complaintId)
    .eq("tenant_id", tenantId);
  revalidatePath("/complaints");
  revalidatePath("/overview");
}

export async function assignComplaintAction(complaintId: string, team: string) {
  const { supabase, tenantId } = await ctx();
  await supabase
    .from("complaints")
    .update({ assigned_team: team, updated_at: new Date().toISOString() })
    .eq("id", complaintId)
    .eq("tenant_id", tenantId);
  revalidatePath("/complaints");
}
