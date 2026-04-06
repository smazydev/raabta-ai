"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  defaultWorkflowDefinition,
  parseWorkflowDefinition,
  resolveLinearExecutionOrder,
} from "@/lib/orchestration/workflow-definition";

async function requireAdmin() {
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
  if (!profile?.tenant_id || typeof profile.tenant_id !== "string") throw new Error("No tenant");
  if (profile.role !== "admin") throw new Error("Admin only");
  return { supabase, tenantId: profile.tenant_id };
}

export async function createWorkflowAction() {
  const { supabase, tenantId } = await requireAdmin();
  const def = defaultWorkflowDefinition();
  const { data, error } = await supabase
    .from("workflows")
    .insert({
      tenant_id: tenantId,
      name: "New workflow",
      description: null,
      enabled: false,
      trigger_type: "manual",
      trigger_config: {},
      channels: ["web_chat", "app_chat", "voice", "agent_assist"],
      definition: def as unknown as Record<string, unknown>,
      sort_order: 0,
    })
    .select("id")
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") {
      throw new Error(
        "Workflow tables are missing. Run migrations 20250330120000_initial_schema.sql and 20250330130000_workflows.sql, then try again."
      );
    }
    throw new Error(error.message || "Could not create workflow");
  }
  if (!data || typeof data.id !== "string") throw new Error("Could not create workflow");

  revalidatePath("/workflows");
  return data.id;
}

export async function createWorkflowAndRedirect() {
  const id = await createWorkflowAction();
  redirect(`/workflows/${id}`);
}

export async function updateWorkflowAction(
  id: string,
  payload: {
    name?: string;
    description?: string | null;
    enabled?: boolean;
    channels?: string[];
    trigger_type?: "manual" | "intent_match";
    trigger_config?: Record<string, unknown>;
    definition?: unknown;
    sort_order?: number;
    category?: string | null;
  }
) {
  const { supabase, tenantId } = await requireAdmin();
  if (payload.definition !== undefined) {
    const parsed = parseWorkflowDefinition(payload.definition);
    resolveLinearExecutionOrder(parsed);
  }
  const { error } = await supabase
    .from("workflows")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) throw error;
  revalidatePath("/workflows");
  revalidatePath(`/workflows/${id}`);
}

export async function deleteWorkflowAction(id: string) {
  const { supabase, tenantId } = await requireAdmin();
  const { error } = await supabase.from("workflows").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
  revalidatePath("/workflows");
}
