import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import {
  aiAgentDepartmentEnum,
  aiAgentKindEnum,
  aiAgentStatusEnum,
  appRoleEnum,
  channelTypeEnum,
  complaintStatusEnum,
  conversationStatusEnum,
  frontdeskOutcomeEnum,
  frontdeskRequestTypeEnum,
  priorityEnum,
  workflowRunStatusEnum,
  workflowStepStatusEnum,
  workflowTriggerTypeEnum,
} from "./enums";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appUsers = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  role: appRoleEnum("role").notNull().default("agent"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  accountNumber: text("account_number"),
  riskLevel: text("risk_level").notNull().default("low"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cards = pgTable("cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  lastFour: text("last_four").notNull(),
  status: text("status").notNull().default("active"),
  product: text("product"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  cardId: uuid("card_id").references(() => cards.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("PKR"),
  description: text("description").notNull(),
  category: text("category"),
  status: text("status").notNull().default("completed"),
});

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    triggerType: workflowTriggerTypeEnum("trigger_type").notNull().default("manual"),
    triggerConfig: jsonb("trigger_config").notNull().default(sql`'{}'::jsonb`),
    channels: channelTypeEnum("channels")
      .array()
      .notNull()
      .default(sql`ARRAY['web_chat','app_chat','voice']::channel_type[]`),
    definition: jsonb("definition")
      .notNull()
      .default(sql`'{"nodes":[],"edges":[]}'::jsonb`),
    version: integer("version").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    slug: text("slug"),
    category: text("category"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("workflows_tenant_slug").on(t.tenantId, t.slug)]
);

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: aiAgentKindEnum("kind").notNull().default("chat"),
    description: text("description"),
    instructions: text("instructions").notNull().default(""),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    status: aiAgentStatusEnum("status").notNull().default("draft"),
    department: aiAgentDepartmentEnum("department"),
    responseStyle: text("response_style"),
    escalationTargetTeam: text("escalation_target_team"),
    citationsRequired: boolean("citations_required").notNull().default(false),
    humanHandoffEnabled: boolean("human_handoff_enabled").notNull().default(true),
    agentAssistEnabled: boolean("agent_assist_enabled").notNull().default(false),
    modelPlaceholder: text("model_placeholder"),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("ai_agents_tenant_slug").on(t.tenantId, t.slug)]
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  channel: channelTypeEnum("channel").notNull(),
  status: conversationStatusEnum("status").notNull().default("active"),
  intent: text("intent"),
  sentiment: text("sentiment"),
  summary: text("summary"),
  containmentResolved: boolean("containment_resolved").notNull().default(false),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  agentId: uuid("agent_id").references(() => aiAgents.id, { onDelete: "set null" }),
});

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  status: conversationStatusEnum("status").notNull().default("active"),
  durationSeconds: integer("duration_seconds"),
  language: text("language").default("English"),
  intent: text("intent"),
  outcome: text("outcome"),
  summary: text("summary"),
  transcript: jsonb("transcript").notNull().default(sql`'[]'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const complaints = pgTable(
  "complaints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    channel: channelTypeEnum("channel").notNull(),
    category: text("category").notNull(),
    priority: priorityEnum("priority").notNull().default("medium"),
    status: complaintStatusEnum("status").notNull().default("new"),
    summary: text("summary").notNull(),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    assignedTeam: text("assigned_team"),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [unique("complaints_reference_tenant").on(t.tenantId, t.reference)]
);

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  complaintId: uuid("complaint_id").references(() => complaints.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentSummaries = pgTable("agent_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  complaintId: uuid("complaint_id").references(() => complaints.id, { onDelete: "cascade" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  suggestedReply: text("suggested_reply"),
  nextActions: jsonb("next_actions").default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("knowledge_bases_tenant_name").on(t.tenantId, t.name)]
);

export const knowledgeArticles = pgTable("knowledge_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  knowledgeBaseId: uuid("knowledge_base_id").references(() => knowledgeBases.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  usageCount: integer("usage_count").notNull().default(0),
  source: text("source").notNull().default("internal_policy"),
  departmentTeam: text("department_team"),
  accessScope: text("access_scope").notNull().default("tenant_wide"),
  readiness: text("readiness").notNull().default("indexed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiAgentKnowledgeArticles = pgTable(
  "ai_agent_knowledge_articles",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => knowledgeArticles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.articleId] })]
);

export const aiAgentKnowledgeBases = pgTable(
  "ai_agent_knowledge_bases",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.knowledgeBaseId] })]
);

export const aiAgentWorkflowAllowlist = pgTable(
  "ai_agent_workflow_allowlist",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.workflowId] })]
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("knowledge_chunks_tenant_source_chunk").on(t.tenantId, t.sourceKind, t.sourceId, t.chunkIndex)]
);

export const storedDocuments = pgTable("stored_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  mimeType: text("mime_type").notNull().default("text/plain"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const liveEvents = pgTable("live_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  body: text("body"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  appName: text("app_name").notNull().default("Raabta AI"),
  channelsEnabled: jsonb("channels_enabled").notNull(),
  aiToggles: jsonb("ai_toggles").notNull(),
  escalationThreshold: integer("escalation_threshold").notNull().default(3),
  romanUrduSupport: boolean("roman_urdu_support").notNull().default(true),
  providerProfile: jsonb("provider_profile").notNull().default(sql`'{}'::jsonb`),
  telephony: jsonb("telephony").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  triggeredBy: uuid("triggered_by").references(() => appUsers.id, { onDelete: "set null" }),
  status: workflowRunStatusEnum("status").notNull().default("running"),
  context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});

export const workflowRunSteps = pgTable("workflow_run_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  status: workflowStepStatusEnum("status").notNull(),
  inputRedacted: jsonb("input_redacted"),
  outputRedacted: jsonb("output_redacted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantApiKeys = pgTable("tenant_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  secretHash: text("secret_hash").notNull(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  quantity: numeric("quantity").notNull().default("1"),
  unit: text("unit").notNull().default("count"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("api"),
  actorLabel: text("actor_label"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const connectors = pgTable("connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  connectorType: text("connector_type").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("disconnected"),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  notes: text("notes"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeeAttributes = pgTable("employee_attributes", {
  profileId: uuid("profile_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  department: text("department"),
  workNature: text("work_nature"),
  areasOfInterest: text("areas_of_interest").array().notNull().default(sql`'{}'::text[]`),
  personalityNotes: text("personality_notes"),
  performanceSummary: text("performance_summary"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const surveyTemplates = pgTable("survey_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
  personalizationContext: jsonb("personalization_context").notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").references(() => appUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const surveyAssignments = pgTable("survey_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  templateId: uuid("template_id")
    .notNull()
    .references(() => surveyTemplates.id, { onDelete: "cascade" }),
  assignedProfileId: uuid("assigned_profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const surveyResponses = pgTable(
  "survey_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => surveyAssignments.id, { onDelete: "cascade" }),
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("survey_responses_assignment").on(t.assignmentId)]
);

export const courseModules = pgTable("course_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  activities: jsonb("activities").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courseAssignments = pgTable(
  "course_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => courseModules.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("not_started"),
    progress: jsonb("progress").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("course_assignments_module_profile").on(t.moduleId, t.profileId)]
);

export const hiringApplications = pgTable(
  "hiring_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    referenceCode: text("reference_code").notNull(),
    secureToken: uuid("secure_token").notNull().defaultRandom(),
    candidateName: text("candidate_name").notNull(),
    candidateEmail: text("candidate_email"),
    stage: text("stage").notNull().default("applied"),
    documentDiscrepancy: text("document_discrepancy"),
    offerIssued: boolean("offer_issued").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("hiring_applications_tenant_ref").on(t.tenantId, t.referenceCode)]
);

export const assistantSessions = pgTable("assistant_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  aiAgentId: uuid("ai_agent_id").references(() => aiAgents.id, { onDelete: "set null" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistantMessages = pgTable("assistant_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => assistantSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content"),
  toolName: text("tool_name"),
  toolPayload: jsonb("tool_payload"),
  artifactMarkdown: text("artifact_markdown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceFrontdeskSessions = pgTable("voice_frontdesk_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  callerPhone: text("caller_phone"),
  callerName: text("caller_name"),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  preferredLanguage: text("preferred_language").notNull().default("ur"),
  languageLocked: boolean("language_locked").notNull().default(false),
  detectedIntent: text("detected_intent"),
  urgency: text("urgency"),
  callbackRequested: boolean("callback_requested").notNull().default(false),
  status: text("status").notNull().default("active"),
  outcome: frontdeskOutcomeEnum("outcome"),
  transferReason: text("transfer_reason"),
  summary: text("summary"),
  disposition: jsonb("disposition").notNull().default(sql`'{}'::jsonb`),
  toolCalls: jsonb("tool_calls").notNull().default(sql`'[]'::jsonb`),
  errorLog: jsonb("error_log").notNull().default(sql`'[]'::jsonb`),
  aiAgentId: uuid("ai_agent_id").references(() => aiAgents.id, { onDelete: "set null" }),
  retrievedKnowledge: jsonb("retrieved_knowledge").notNull().default(sql`'[]'::jsonb`),
  handoffState: text("handoff_state"),
  structuredSummary: text("structured_summary"),
  twilioCallSid: text("twilio_call_sid"),
  twilioParentCallSid: text("twilio_parent_call_sid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const voiceFrontdeskTurns = pgTable("voice_frontdesk_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => voiceFrontdeskSessions.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  language: text("language"),
  text: text("text").notNull(),
  redactedText: text("redacted_text"),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const frontdeskRequests = pgTable("frontdesk_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => voiceFrontdeskSessions.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  requestType: frontdeskRequestTypeEnum("request_type").notNull(),
  externalRef: text("external_ref"),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("created"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
