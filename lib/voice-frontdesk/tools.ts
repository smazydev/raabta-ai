import type { AppDbClient } from "@/lib/db/types";
import { createComplaintRecord } from "@/lib/orchestration/workflows";
import { searchKnowledge, type SearchKnowledgeOptions } from "@/lib/knowledge/retrieve";
import {
  getMockInterviewProgressPayload,
  type MockInterviewProgressPayload,
} from "@/lib/voice-frontdesk/interview-progress-workflow";

export type FrontdeskToolset = ReturnType<typeof createFrontdeskToolset>;

export type CreateFrontdeskToolsetOptions = {
  /** When set, retrieval is limited to these article IDs (from agent knowledge bases + direct links). */
  allowedArticleIds?: string[];
  /**
   * When true, never queries tenant knowledge search — voice line uses only scripted flows (e.g. hiring mock).
   * Hours/locations return generic canned text without retrieval.
   */
  knowledgeSearchDisabled?: boolean;
};

export function createFrontdeskToolset(
  supabase: AppDbClient,
  tenantId: string,
  options?: CreateFrontdeskToolsetOptions
) {
  const knowledgeOff = options?.knowledgeSearchDisabled === true;
  const searchOpts: SearchKnowledgeOptions | undefined =
    !knowledgeOff && options?.allowedArticleIds !== undefined
      ? { allowedArticleIds: options.allowedArticleIds }
      : undefined;

  const sk = (query: string, lim: number) =>
    searchKnowledge(supabase, tenantId, query, lim, searchOpts);

  return {
    async createTicket(input: { customerId?: string | null; summary: string; callId?: string | null }) {
      if (!input.customerId) throw new Error("customer missing");
      const r = await createComplaintRecord({
        supabase,
        tenantId,
        customerId: input.customerId,
        channel: "voice",
        category: "Voice front-desk",
        summary: input.summary,
        callId: input.callId ?? null,
        priority: "medium",
      });
      return { id: r.id, ref: r.reference };
    },
    async requestCallback(input: {
      sessionId: string;
      customerId?: string | null;
      phone?: string;
      reason?: string;
    }) {
      const { data, error } = await supabase
        .from("frontdesk_requests")
        .insert({
          tenant_id: tenantId,
          session_id: input.sessionId,
          customer_id: input.customerId ?? null,
          request_type: "callback",
          payload: { phone: input.phone ?? null, reason: input.reason ?? null },
        })
        .select("id")
        .single();
      if (error) throw error;
      if (!data || typeof data.id !== "string") throw new Error("Failed to create callback request");
      return { id: data.id };
    },
    async createLead(input: { sessionId: string; phone?: string; name?: string; reason?: string }) {
      const { data, error } = await supabase
        .from("frontdesk_requests")
        .insert({
          tenant_id: tenantId,
          session_id: input.sessionId,
          request_type: "lead",
          payload: { phone: input.phone ?? null, name: input.name ?? null, reason: input.reason ?? null },
        })
        .select("id")
        .single();
      if (error) throw error;
      if (!data || typeof data.id !== "string") throw new Error("Failed to create lead");
      return { id: data.id };
    },
    async lookupCustomerByPhone(phone: string) {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone, account_number")
        .eq("tenant_id", tenantId)
        .eq("phone", phone)
        .maybeSingle();
      return data;
    },
    async lookupCustomerById(customerId: string) {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone, account_number")
        .eq("tenant_id", tenantId)
        .eq("id", customerId)
        .maybeSingle();
      return data;
    },
    async getBusinessHours() {
      if (knowledgeOff) return "Support hours are 9am to 6pm, Monday to Friday.";
      const rows = await sk("business hours office timing support", 1);
      return rows[0]?.body ?? "Support hours are 9am to 6pm, Monday to Friday.";
    },
    async getOfficeLocations() {
      if (knowledgeOff) return "Main office is available through central helpline and branch network.";
      const rows = await sk("office locations branch", 1);
      return rows[0]?.body ?? "Main office is available through central helpline and branch network.";
    },
    async getFaqAnswer(query: string) {
      if (knowledgeOff) return null;
      const rows = await sk(query, 2);
      return rows[0]?.body ?? null;
    },
    async transferToHuman(input: { sessionId: string; reason: string }) {
      await supabase
        .from("voice_frontdesk_sessions")
        .update({
          status: "transferred",
          outcome: "transferred",
          transfer_reason: input.reason,
          ended_at: new Date().toISOString(),
        })
        .eq("id", input.sessionId)
        .eq("tenant_id", tenantId);
      return { ok: true };
    },
    async saveDisposition(input: {
      sessionId: string;
      summary: string;
      intent: string;
      disposition: Record<string, unknown>;
      outcome: "resolved" | "transferred" | "callback_scheduled" | "ticket_created";
    }) {
      await supabase
        .from("voice_frontdesk_sessions")
        .update({
          summary: input.summary,
          detected_intent: input.intent,
          disposition: input.disposition,
          outcome: input.outcome,
          status: input.outcome === "transferred" ? "transferred" : "resolved",
          ended_at: new Date().toISOString(),
        })
        .eq("id", input.sessionId)
        .eq("tenant_id", tenantId);
      return { ok: true };
    },
    async sendSmsConfirmation(input: { phone: string; message: string }) {
      // Mock hook; keep server-side for future provider integration.
      return { ok: true, providerRef: `sms-${input.phone.slice(-4)}` };
    },
    /**
     * Mock workflow: candidate interview / hiring pipeline status.
     * Swap for `runWorkflow` + tenant workflow id when orchestration is wired.
     */
    async runMockInterviewProgressWorkflow(input: {
      utterance: string;
      referenceCode?: string | null;
    }): Promise<MockInterviewProgressPayload> {
      return getMockInterviewProgressPayload({
        utterance: input.utterance,
        referenceCode: input.referenceCode?.trim() || undefined,
      });
    },
  };
}
