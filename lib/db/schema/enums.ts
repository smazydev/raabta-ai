import { pgEnum } from "drizzle-orm/pg-core";

/** Mirrors Postgres enums in `supabase/migrations/` — do not rename values. */
export const appRoleEnum = pgEnum("app_role", ["admin", "agent"]);

export const channelTypeEnum = pgEnum("channel_type", [
  "web_chat",
  "app_chat",
  "voice",
  "agent_assist",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "escalated",
  "resolved",
  "pending",
]);

export const complaintStatusEnum = pgEnum("complaint_status", [
  "new",
  "in_review",
  "awaiting_customer",
  "escalated",
  "resolved",
  "closed",
]);

export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "critical"]);

export const workflowTriggerTypeEnum = pgEnum("workflow_trigger_type", ["manual", "intent_match"]);

export const workflowRunStatusEnum = pgEnum("workflow_run_status", ["running", "success", "failed"]);

export const workflowStepStatusEnum = pgEnum("workflow_step_status", ["success", "failed", "skipped"]);

export const frontdeskOutcomeEnum = pgEnum("frontdesk_outcome", [
  "resolved",
  "transferred",
  "callback_scheduled",
  "ticket_created",
  "dropped",
  "failed",
]);

export const frontdeskRequestTypeEnum = pgEnum("frontdesk_request_type", ["ticket", "callback", "lead"]);

export const aiAgentStatusEnum = pgEnum("ai_agent_status", ["draft", "live", "archived"]);

export const aiAgentDepartmentEnum = pgEnum("ai_agent_department", [
  "HR",
  "IT",
  "Operations",
  "Compliance",
  "Support",
]);

export const aiAgentKindEnum = pgEnum("ai_agent_kind", ["chat", "voice", "both"]);
