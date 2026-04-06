"use server";

import { revalidatePath } from "next/cache";
import { getSessionTenant } from "@/lib/session";

export async function createHiringApplicationAction(formData: FormData) {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  if (session.role !== "admin") throw new Error("Admin only");

  const reference_code = String(formData.get("reference_code") ?? "").trim();
  const candidate_name = String(formData.get("candidate_name") ?? "").trim();
  const candidate_email = String(formData.get("candidate_email") ?? "").trim() || null;
  const stage = String(formData.get("stage") ?? "applied").trim();
  const document_discrepancy = String(formData.get("document_discrepancy") ?? "").trim() || null;
  const offer_issued = formData.get("offer_issued") === "on";

  if (!reference_code) throw new Error("Reference code is required");
  if (!candidate_name) throw new Error("Candidate name is required");

  const supabase = session.supabase;
  const { error } = await supabase.from("hiring_applications").insert({
    tenant_id: session.tenantId,
    reference_code,
    candidate_name,
    candidate_email,
    stage,
    document_discrepancy,
    offer_issued,
    updated_at: new Date().toISOString(),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/hr");
}
