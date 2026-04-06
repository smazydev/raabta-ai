/**
 * Seed demo tenant + data + app_users (requires DATABASE_URL or POSTGRES_URL / SUPABASE_DATABASE_URL).
 * Run: npm run db:seed  /  npx tsx scripts/seed.ts
 */
import * as dotenv from "dotenv";
import { resolvePostgresConnectionString } from "../lib/db/connection-string";
import { getPool } from "../lib/db/pool";
import { createServiceRoleClient } from "../lib/db/service-client";

dotenv.config({ path: ".env.local" });
dotenv.config();

if (!resolvePostgresConnectionString()) {
  console.error("Missing DATABASE_URL (or POSTGRES_URL / SUPABASE_DATABASE_URL)");
  process.exit(1);
}

const admin = createServiceRoleClient();

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_EMAIL = "admin@demo.raabta.ai";
const AGENT_EMAIL = "agent@demo.raabta.ai";
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD || "DemoRaabta123!";

function assertNoDbError(label: string, result: { error?: { message?: string } | null }) {
  if (result.error) throw new Error(`${label}: ${result.error.message ?? "unknown error"}`);
}

/** Seed only writes app_users; profiles.id must FK to app_users, not auth.users. */
async function assertProfilesFkReferencesAppUsers() {
  const pool = getPool();
  const { rows } = await pool.query<{ def: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     WHERE c.conrelid = 'public.profiles'::regclass
       AND c.contype = 'f'
       AND c.conname = 'profiles_id_fkey'`
  );
  if (rows.length === 0) return;
  const def = rows[0]!.def;
  if (!/REFERENCES\s+(public\.)?app_users\s*\(/i.test(def)) {
    throw new Error(
      `profiles_id_fkey must reference public.app_users; database has: ${def}\n` +
        `Apply: supabase/migrations/20260406150000_fix_profiles_fkey_app_users.sql`
    );
  }
}

async function main() {
  await assertProfilesFkReferencesAppUsers();

  const { data: tenantRow } = await admin.from("tenants").select("id").eq("id", TENANT_ID).maybeSingle();
  if (!tenantRow) {
    const { error } = await admin.from("tenants").insert({
      id: TENANT_ID,
      name: "Demo Bank PK",
      slug: "demo-bank-pk",
    });
    if (error) throw error;
    console.log("Inserted tenant");
  }

  await admin.from("settings").upsert({
    tenant_id: TENANT_ID,
    app_name: "Raabta AI",
    channels_enabled: {
      web_chat: true,
      app_chat: true,
      voice: true,
      agent_assist: true,
    },
    ai_toggles: { auto_reply: true, summaries: true },
    escalation_threshold: 3,
    roman_urdu_support: true,
    telephony: {},
  });

  await admin.from("tenant_billing").upsert(
    {
      tenant_id: TENANT_ID,
      credit_balance: 2_000_000,
      included_credits_monthly: 500_000,
      payg_enabled: true,
      base_platform_fee_usd: 299,
      credits_per_usd_payg: 5000,
    },
    { onConflict: "tenant_id" }
  );

  const { data: userListOnce } = await admin.auth.admin.listUsers();
  const byEmail = new Map((userListOnce?.users ?? []).map((u) => [u.email.toLowerCase(), u.id]));

  for (const [email, role, name] of [
    [ADMIN_EMAIL, "admin", "Ayesha Malik"],
    [AGENT_EMAIL, "agent", "Bilal Hussain"],
  ] as const) {
    const key = email.toLowerCase();
    let userId = byEmail.get(key);
    if (!userId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: name },
      });
      if (error) throw error;
      userId = created!.user!.id;
      byEmail.set(key, userId);
      console.log("Created user", email);
    }
    assertNoDbError(
      `profiles upsert (${email})`,
      await admin.from("profiles").upsert(
        {
          id: userId,
          tenant_id: TENANT_ID,
          role,
          display_name: name,
        },
        { onConflict: "id" }
      )
    );
  }

  const customers = [
    {
      id: "22222222-2222-4222-8222-222222222201",
      full_name: "Zeeshan Ahmed",
      phone: "+92 300 1234567",
      email: "zeeshan.ahmed@example.pk",
      account_number: "PK12345678901234",
      risk_level: "low",
    },
    {
      id: "22222222-2222-4222-8222-222222222202",
      full_name: "Fatima Khan",
      phone: "+92 321 9876543",
      email: "fatima.khan@example.pk",
      account_number: "PK98765432109876",
      risk_level: "medium",
    },
    {
      id: "22222222-2222-4222-8222-222222222203",
      full_name: "Imran Malik",
      phone: "+92 333 5556667",
      email: "imran.malik@example.pk",
      account_number: "PK55566677788899",
      risk_level: "high",
    },
    {
      id: "22222222-2222-4222-8222-222222222204",
      full_name: "Sana Sheikh",
      phone: "+92 345 1112223",
      email: "sana.sheikh@example.pk",
      account_number: "PK11122233344455",
      risk_level: "low",
    },
  ];

  for (const c of customers) {
    await admin.from("customers").upsert({ ...c, tenant_id: TENANT_ID });
  }

  const cards = [
    {
      id: "33333333-3333-4333-8333-333333333301",
      customer_id: customers[0].id,
      last_four: "4455",
      status: "active",
      product: "Debit Classic",
    },
    {
      id: "33333333-3333-4333-8333-333333333302",
      customer_id: customers[1].id,
      last_four: "8899",
      status: "active",
      product: "Debit Gold",
    },
  ];
  for (const c of cards) {
    await admin.from("cards").upsert({ ...c, tenant_id: TENANT_ID });
  }

  const txns = [
    {
      id: "44444444-4444-4444-8444-444444444401",
      customer_id: customers[0].id,
      card_id: cards[0].id,
      amount: 15000,
      description: "ATM Withdrawal - Blue Area, Islamabad",
      category: "Cash",
      status: "completed",
    },
    {
      id: "44444444-4444-4444-8444-444444444402",
      customer_id: customers[1].id,
      card_id: cards[1].id,
      amount: 45000,
      description: "Suspicious Online Transaction - London, UK",
      category: "Online",
      status: "suspicious",
    },
    {
      id: "44444444-4444-4444-8444-444444444403",
      customer_id: customers[1].id,
      amount: 5000,
      description: "Raast Transfer — failed reconciliation",
      category: "Transfer",
      status: "pending",
    },
  ];
  for (const t of txns) {
    await admin.from("transactions").upsert({
      ...t,
      tenant_id: TENANT_ID,
      currency: "PKR",
    });
  }

  const AGENT_IT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  const AGENT_VOICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
  const AGENT_HR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";

  await admin.from("ai_agents").upsert(
    [
      {
        id: AGENT_IT_ID,
        tenant_id: TENANT_ID,
        name: "IT Help Desk agent",
        slug: "it-help-desk",
        kind: "chat",
        status: "live",
        department: "IT",
        description: "VPN, account lockout, email access, and service desk triage with workflow hooks.",
        instructions:
          "Triage clearly. Prefer password reset and ticketing workflows. Escalate to L2 with a structured summary when unresolved.",
        response_style: "Concise, technical, step-oriented",
        escalation_target_team: "L2 IT Operations",
        citations_required: true,
        human_handoff_enabled: true,
        agent_assist_enabled: true,
        model_placeholder: "Tenant default — controlled OpenAI route",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: AGENT_VOICE_ID,
        tenant_id: TENANT_ID,
        name: "Internal voice hotline",
        slug: "voice-front-desk",
        kind: "both",
        status: "live",
        department: "Support",
        description: "Staff-facing voice surface aligned with the same KB and workflows as chat.",
        instructions:
          "Short sentences. Confirm intent. Quote only from approved knowledge. Offer human handoff with structured summary.",
        response_style: "Calm, professional",
        escalation_target_team: "Contact center supervisor",
        citations_required: true,
        human_handoff_enabled: true,
        agent_assist_enabled: true,
        model_placeholder: "Tenant default — realtime voice stack (demo: simulator)",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: AGENT_HR_ID,
        tenant_id: TENANT_ID,
        name: "HR Policy Assistant",
        slug: "hr-policy",
        kind: "chat",
        status: "live",
        department: "HR",
        description: "Leave, probation, payroll timing, and internal policy Q&A with mandatory citations.",
        instructions:
          "Answer only from HR knowledge articles. If policy is ambiguous, escalate to HRBP with citations attempted.",
        response_style: "Formal, empathetic",
        escalation_target_team: "HR Business Partner queue",
        citations_required: true,
        human_handoff_enabled: true,
        agent_assist_enabled: false,
        model_placeholder: "Tenant default — controlled OpenAI route",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: "id" }
  );

  const conv1 = "55555555-5555-4555-8555-555555555501";
  const conv2 = "55555555-5555-4555-8555-555555555502";
  const conv3 = "55555555-5555-4555-8555-555555555503";
  await admin.from("conversations").upsert([
    {
      id: conv1,
      tenant_id: TENANT_ID,
      customer_id: customers[0].id,
      channel: "web_chat",
      status: "active",
      intent: "Card block",
      sentiment: "negative",
      summary: "Customer lost wallet; block requested for card ending 4455.",
      last_message_at: new Date().toISOString(),
      agent_id: AGENT_IT_ID,
    },
    {
      id: conv2,
      tenant_id: TENANT_ID,
      customer_id: customers[1].id,
      channel: "app_chat",
      status: "escalated",
      intent: "Raast issue",
      sentiment: "negative",
      summary: "Raast transfer failed; funds deducted.",
      last_message_at: new Date().toISOString(),
      agent_id: AGENT_IT_ID,
    },
    {
      id: conv3,
      tenant_id: TENANT_ID,
      customer_id: customers[3].id,
      channel: "web_chat",
      status: "active",
      intent: "Annual leave policy",
      sentiment: "neutral",
      summary: "Staff asking about encashment and carry-forward rules for annual leave.",
      last_message_at: new Date().toISOString(),
      agent_id: AGENT_HR_ID,
    },
  ]);

  await admin.from("conversation_messages").delete().eq("conversation_id", conv1);
  await admin.from("conversation_messages").delete().eq("conversation_id", conv2);
  await admin.from("conversation_messages").delete().eq("conversation_id", conv3);
  await admin.from("conversation_messages").insert([
    {
      tenant_id: TENANT_ID,
      conversation_id: conv1,
      sender: "customer",
      body: "Salam, I lost my wallet — please block my card.",
    },
    {
      tenant_id: TENANT_ID,
      conversation_id: conv1,
      sender: "ai",
      body: "Walaikum assalam. I can block your card ending 4455 immediately.",
    },
    {
      tenant_id: TENANT_ID,
      conversation_id: conv2,
      sender: "customer",
      body: "Raast transfer fail hogaya, paisa kat gaya.",
    },
    {
      tenant_id: TENANT_ID,
      conversation_id: conv2,
      sender: "ai",
      body: "I’m sorry — I’ve logged a reconciliation case for your Raast transfer.",
    },
    {
      tenant_id: TENANT_ID,
      conversation_id: conv3,
      sender: "customer",
      body: "What is our policy on encashing unused annual leave this year?",
    },
    {
      tenant_id: TENANT_ID,
      conversation_id: conv3,
      sender: "ai",
      body: "Per the HR leave SOP, encashment is allowed once per calendar year for up to 10 days, subject to payroll cutoff on the 20th. I can escalate to HRBP if your grade band has exceptions.",
    },
  ]);

  const call1 = "66666666-6666-4666-8666-666666666601";
  await admin.from("calls").upsert({
    id: call1,
    tenant_id: TENANT_ID,
    customer_id: customers[2].id,
    status: "escalated",
    duration_seconds: 420,
    language: "Roman Urdu",
    intent: "Fee dispute",
    transcript: [
      { sender: "customer", text: "Annual fee zyada lag rahi hai", ts: new Date().toISOString() },
      { sender: "ai", text: "Main aapki policy check kar ke agent ko handoff kar raha hoon.", ts: new Date().toISOString() },
    ],
    summary: "Customer disputes annual card fee; escalated for policy review.",
  });

  await admin.from("complaints").upsert([
    {
      id: "77777777-7777-4777-8777-777777777701",
      tenant_id: TENANT_ID,
      customer_id: customers[1].id,
      reference: "CMP-2026-0142",
      channel: "app_chat",
      category: "Raast / IBFT",
      priority: "high",
      status: "escalated",
      summary: "Failed Raast transfer; debit without credit.",
      conversation_id: conv2,
      sla_due_at: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
      assigned_team: "Digital Payments",
    },
    {
      id: "77777777-7777-4777-8777-777777777702",
      tenant_id: TENANT_ID,
      customer_id: customers[2].id,
      reference: "CMP-2026-0098",
      channel: "voice",
      category: "Fees & charges",
      priority: "medium",
      status: "in_review",
      summary: "Annual fee dispute on premium card.",
      call_id: call1,
      sla_due_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      assigned_team: "Cards",
    },
  ]);

  await admin.from("knowledge_articles").upsert(
    [
      {
        id: "88888888-8888-4888-8888-888888888801",
        tenant_id: TENANT_ID,
        title: "ATM withdrawal limits (retail SOP)",
        body: "Standard debit daily ATM withdrawal limit is PKR 150,000 for retail customers. Premium tiers may request temporary increases via the mobile app or branch.",
        tags: ["limits", "atm", "card"],
        source: "internal_policy",
        department_team: "Operations",
        access_scope: "tenant_wide",
        readiness: "indexed",
      },
      {
        id: "88888888-8888-4888-8888-888888888802",
        tenant_id: TENANT_ID,
        title: "Card block and reissue",
        body: "Customers can block cards instantly via app chat or IVR. Reissue is dispatched within 5–7 business days; PKR 1,500 replacement fee may apply unless waived under fraud investigation.",
        tags: ["card", "block", "fraud"],
        source: "internal_policy",
        department_team: "Operations",
        access_scope: "tenant_wide",
        readiness: "indexed",
      },
      {
        id: "88888888-8888-4888-8888-888888888803",
        tenant_id: TENANT_ID,
        title: "Complaint SLA matrix",
        body: "P0/P1 complaints: first response within 2 hours, resolution target 1 business day. Raast reconciliation cases are treated as P1 when funds are missing.",
        tags: ["sla", "complaints"],
        source: "internal_policy",
        department_team: "Support",
        access_scope: "tenant_wide",
        readiness: "indexed",
      },
      {
        id: "88888888-8888-4888-8888-888888888804",
        tenant_id: TENANT_ID,
        title: "Failed Raast transfer — reconciliation",
        body: "If Raast shows failed but account is debited, create a reconciliation ticket with trace ID, amount, and beneficiary IBAN. Do not advise second transfer until reversal or confirmation from switch.",
        tags: ["raast", "payments"],
        source: "internal_policy",
        department_team: "Digital Payments",
        access_scope: "tenant_wide",
        readiness: "indexed",
      },
      {
        id: "88888888-8888-4888-8888-888888888805",
        tenant_id: TENANT_ID,
        title: "HR — Annual leave encashment & carry-forward",
        body: "Employees may encash up to 10 unused annual leave days once per calendar year. Payroll cutoff is the 20th of each month. Carry-forward beyond 20 days requires HRBP approval per grade band.",
        tags: ["hr", "leave", "payroll"],
        source: "hr_policy_pdf",
        department_team: "HR",
        access_scope: "hr_only",
        readiness: "indexed",
      },
      {
        id: "88888888-8888-4888-8888-888888888806",
        tenant_id: TENANT_ID,
        title: "IT — VPN and password reset standard",
        body: "Staff VPN lockouts: verify MFA device, then trigger password reset workflow. For shared mailboxes, route to messaging team. Never share passwords in chat — send reset link only.",
        tags: ["it", "vpn", "password"],
        source: "it_runbook",
        department_team: "IT",
        access_scope: "it_only",
        readiness: "indexed",
      },
      {
        id: "88888888-8888-4888-8888-888888888807",
        tenant_id: TENANT_ID,
        title: "Compliance — Internal fraud & suspicious activity",
        body: "If a staff member reports suspicious internal movement of funds or credential sharing, open a restricted ticket to Compliance Investigations. Do not disclose case IDs to the reporter.",
        tags: ["compliance", "fraud"],
        source: "compliance_manual",
        department_team: "Compliance",
        access_scope: "tenant_wide",
        readiness: "indexed",
      },
      {
        id: "88888888-8888-4888-8888-888888888808",
        tenant_id: TENANT_ID,
        title: "Branch operations — callback scheduling",
        body: "Branch callback requests: capture preferred time window, CNIC last 4, and topic. Dispatch to regional operations queue within 4 business hours.",
        tags: ["branch", "callback"],
        source: "branch_sop",
        department_team: "Operations",
        access_scope: "branch_staff",
        readiness: "indexed",
      },
    ],
    { onConflict: "id" }
  );

  const WF_CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001";
  const WF_VOICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002";
  const WF_PING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003";
  const WF_INTENT_RAAST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004";

  const defCardFraud = {
    nodes: [
      { id: "trigger_1", type: "trigger_manual", name: "Start" },
      {
        id: "n1",
        type: "internal",
        name: "Block card",
        config: { internal_key: "block_card" },
      },
      {
        id: "n2",
        type: "internal",
        name: "Complaint",
        config: {
          internal_key: "create_complaint",
          category: "Card / fraud",
          summary: "Card blocked via fraud workflow (demo).",
        },
      },
      {
        id: "n3",
        type: "http_request",
        name: "Notify adapter",
        config: {
          method: "POST",
          path_template: "/v1/cards/{cardId}/block-notify",
          body_template: {
            customerId: "{customerId}",
            conversationId: "{conversationId}",
          },
        },
      },
    ],
    edges: [
      { source: "trigger_1", target: "n1" },
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
    ],
  };

  const defVoiceFreeze = {
    nodes: [
      { id: "trigger_1", type: "trigger_manual", name: "Start" },
      {
        id: "v1",
        type: "internal",
        name: "Freeze card",
        config: { internal_key: "freeze_card" },
      },
      {
        id: "v2",
        type: "internal",
        name: "Complaint",
        config: {
          internal_key: "create_complaint",
          category: "Card / fraud",
          summary: "Voice: card frozen via workflow (demo).",
        },
      },
    ],
    edges: [
      { source: "trigger_1", target: "v1" },
      { source: "v1", target: "v2" },
    ],
  };

  const defPing = {
    nodes: [
      { id: "trigger_1", type: "trigger_manual", name: "Start" },
      {
        id: "p1",
        type: "http_request",
        name: "Ping",
        config: { method: "GET", path_template: "/v1/ping" },
      },
    ],
    edges: [{ source: "trigger_1", target: "p1" }],
  };

  const defIntentRaast = {
    nodes: [
      { id: "trigger_1", type: "trigger_manual", name: "Start" },
      {
        id: "r1",
        type: "internal",
        name: "Raast complaint",
        config: {
          internal_key: "create_complaint",
          category: "Raast / IBFT",
          summary: "Opened from intent-matched workflow (demo).",
        },
      },
    ],
    edges: [{ source: "trigger_1", target: "r1" }],
  };

  const defTicket = (stepName: string, category: string, summary: string) => ({
    nodes: [
      { id: "trigger_1", type: "trigger_manual", name: "Start" },
      {
        id: "t1",
        type: "internal",
        name: stepName,
        config: {
          internal_key: "create_complaint",
          category,
          summary,
        },
      },
    ],
    edges: [{ source: "trigger_1", target: "t1" }],
  });

  const defResetPassword = {
    nodes: [
      { id: "trigger_1", type: "trigger_manual", name: "Start" },
      {
        id: "u1",
        type: "http_request",
        name: "POST reset request",
        config: {
          method: "POST",
          path_template: "/v1/users/{customerId}/password-reset",
          body_template: { channel: "secure_link" },
        },
      },
    ],
    edges: [{ source: "trigger_1", target: "u1" }],
  };

  const WF_RESET = "aaaaaaaa-aaaa-4aaa-8aaa-0bad00000001";
  const WF_IT_TICKET = "aaaaaaaa-aaaa-4aaa-8aaa-0bad00000002";
  const WF_HR_PAYROLL = "aaaaaaaa-aaaa-4aaa-8aaa-0bad00000003";
  const WF_FRAUD = "aaaaaaaa-aaaa-4aaa-8aaa-0bad00000004";
  const WF_BRANCH = "aaaaaaaa-aaaa-4aaa-8aaa-0bad00000005";
  const WF_COMPLIANCE = "aaaaaaaa-aaaa-4aaa-8aaa-0bad00000006";

  const nowIso = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();

  await admin.from("workflows").upsert(
    [
      {
        id: WF_CARD,
        tenant_id: TENANT_ID,
        name: "Card fraud — block + complaint + adapter",
        description: "Blocks card, opens complaint, POSTs to mock bank adapter.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["app_chat", "web_chat", "voice"],
        definition: defCardFraud,
        sort_order: 1,
        slug: "card-fraud-block",
        category: "Service desk",
        run_count: 42,
        last_run_at: nowIso,
      },
      {
        id: WF_VOICE,
        tenant_id: TENANT_ID,
        name: "Voice — freeze + complaint",
        description: "Freeze card and log complaint from voice channel.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["voice"],
        definition: defVoiceFreeze,
        sort_order: 2,
        slug: "voice-freeze",
        category: "Service desk",
        run_count: 18,
        last_run_at: yesterday,
      },
      {
        id: WF_PING,
        tenant_id: TENANT_ID,
        name: "Adapter health ping",
        description: "GET /v1/ping on the in-app mock adapter.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["web_chat", "app_chat", "voice"],
        definition: defPing,
        sort_order: 3,
        slug: "adapter-ping",
        category: "Platform operations",
        run_count: 256,
        last_run_at: nowIso,
      },
      {
        id: WF_INTENT_RAAST,
        tenant_id: TENANT_ID,
        name: "Intent: Raast issue",
        description: "Suggested when conversation intent matches Raast issue.",
        enabled: true,
        trigger_type: "intent_match",
        trigger_config: { intent: "Raast issue" },
        channels: ["app_chat", "web_chat", "voice"],
        definition: defIntentRaast,
        sort_order: 4,
        slug: "intent-raast",
        category: "Digital payments",
        run_count: 31,
        last_run_at: yesterday,
      },
      {
        id: WF_RESET,
        tenant_id: TENANT_ID,
        name: "Reset password request",
        description: "HTTP adapter step to issue secure reset (demo).",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["web_chat", "app_chat", "voice"],
        definition: defResetPassword,
        sort_order: 5,
        slug: "reset-password",
        category: "IT support",
        run_count: 64,
        last_run_at: nowIso,
      },
      {
        id: WF_IT_TICKET,
        tenant_id: TENANT_ID,
        name: "Create IT support ticket",
        description: "Standard IT ticket with category routing.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["web_chat", "app_chat", "voice", "agent_assist"],
        definition: defTicket("Open IT ticket", "IT / Service desk", "Created from IT Help Desk workflow (demo)."),
        sort_order: 6,
        slug: "it-ticket",
        category: "IT support",
        run_count: 112,
        last_run_at: nowIso,
      },
      {
        id: WF_HR_PAYROLL,
        tenant_id: TENANT_ID,
        name: "Route payroll query to HR",
        description: "Creates HR queue item for payroll timing questions.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["web_chat", "app_chat"],
        definition: defTicket("HR payroll route", "HR / Payroll", "Payroll timing query from AI assist (demo)."),
        sort_order: 7,
        slug: "hr-payroll-route",
        category: "HR operations",
        run_count: 27,
        last_run_at: yesterday,
      },
      {
        id: WF_FRAUD,
        tenant_id: TENANT_ID,
        name: "Escalate suspicious internal activity",
        description: "Compliance investigations intake.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["web_chat", "app_chat", "voice", "agent_assist"],
        definition: defTicket(
          "Compliance escalation",
          "Compliance / AML",
          "Internal fraud concern escalated from AI channel (demo)."
        ),
        sort_order: 8,
        slug: "fraud-escalation",
        category: "Compliance",
        run_count: 6,
        last_run_at: yesterday,
      },
      {
        id: WF_BRANCH,
        tenant_id: TENANT_ID,
        name: "Request branch operations callback",
        description: "Branch callback scheduling ticket.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["voice", "web_chat", "app_chat"],
        definition: defTicket("Branch callback", "Branch operations", "Callback requested via AI (demo)."),
        sort_order: 9,
        slug: "branch-callback",
        category: "Branch operations",
        run_count: 19,
        last_run_at: nowIso,
      },
      {
        id: WF_COMPLIANCE,
        tenant_id: TENANT_ID,
        name: "Compliance policy clarification",
        description: "Policy Q&A handoff with reference logging.",
        enabled: true,
        trigger_type: "manual",
        trigger_config: {},
        channels: ["web_chat", "app_chat", "agent_assist"],
        definition: defTicket(
          "Policy clarification",
          "Compliance / Policy",
          "Policy clarification request from governed agent (demo)."
        ),
        sort_order: 10,
        slug: "compliance-clarification",
        category: "Compliance",
        run_count: 14,
        last_run_at: yesterday,
      },
    ],
    { onConflict: "id" }
  );

  await admin.from("ai_agents").update({ workflow_id: WF_IT_TICKET }).eq("id", AGENT_IT_ID).eq("tenant_id", TENANT_ID);
  await admin.from("ai_agents").update({ workflow_id: WF_VOICE }).eq("id", AGENT_VOICE_ID).eq("tenant_id", TENANT_ID);
  await admin.from("ai_agents").update({ workflow_id: WF_HR_PAYROLL }).eq("id", AGENT_HR_ID).eq("tenant_id", TENANT_ID);

  await admin.from("ai_agent_knowledge_articles").delete().eq("tenant_id", TENANT_ID);
  await admin.from("ai_agent_knowledge_articles").insert([
    { tenant_id: TENANT_ID, agent_id: AGENT_IT_ID, article_id: "88888888-8888-4888-8888-888888888806" },
    { tenant_id: TENANT_ID, agent_id: AGENT_IT_ID, article_id: "88888888-8888-4888-8888-888888888804" },
    { tenant_id: TENANT_ID, agent_id: AGENT_IT_ID, article_id: "88888888-8888-4888-8888-888888888802" },
    { tenant_id: TENANT_ID, agent_id: AGENT_HR_ID, article_id: "88888888-8888-4888-8888-888888888805" },
    { tenant_id: TENANT_ID, agent_id: AGENT_HR_ID, article_id: "88888888-8888-4888-8888-888888888803" },
    { tenant_id: TENANT_ID, agent_id: AGENT_VOICE_ID, article_id: "88888888-8888-4888-8888-888888888801" },
    { tenant_id: TENANT_ID, agent_id: AGENT_VOICE_ID, article_id: "88888888-8888-4888-8888-888888888808" },
  ]);

  await admin.from("ai_agent_workflow_allowlist").delete().eq("tenant_id", TENANT_ID);
  await admin.from("ai_agent_workflow_allowlist").insert([
    { tenant_id: TENANT_ID, agent_id: AGENT_IT_ID, workflow_id: WF_IT_TICKET },
    { tenant_id: TENANT_ID, agent_id: AGENT_IT_ID, workflow_id: WF_RESET },
    { tenant_id: TENANT_ID, agent_id: AGENT_IT_ID, workflow_id: WF_PING },
    { tenant_id: TENANT_ID, agent_id: AGENT_IT_ID, workflow_id: WF_INTENT_RAAST },
    { tenant_id: TENANT_ID, agent_id: AGENT_HR_ID, workflow_id: WF_HR_PAYROLL },
    { tenant_id: TENANT_ID, agent_id: AGENT_HR_ID, workflow_id: WF_COMPLIANCE },
    { tenant_id: TENANT_ID, agent_id: AGENT_VOICE_ID, workflow_id: WF_VOICE },
    { tenant_id: TENANT_ID, agent_id: AGENT_VOICE_ID, workflow_id: WF_BRANCH },
    { tenant_id: TENANT_ID, agent_id: AGENT_VOICE_ID, workflow_id: WF_FRAUD },
  ]);

  const vfs1 = "cccccccc-cccc-4ccc-8ccc-cccccccc0001";
  await admin.from("voice_frontdesk_turns").delete().eq("session_id", vfs1);
  await admin.from("voice_frontdesk_sessions").upsert(
    {
      id: vfs1,
      tenant_id: TENANT_ID,
      caller_name: "Internal staff — branch ops",
      caller_phone: "+92 300 0001122",
      customer_id: customers[3].id,
      preferred_language: "ur",
      detected_intent: "Branch vault access issue",
      urgency: "medium",
      status: "ended",
      outcome: "callback_scheduled",
      summary: "Staff member asked about delayed vault reconciliation; callback scheduled with regional ops.",
      structured_summary:
        "Intent: branch operations / vault | Risk: low | Action: branch callback workflow eligible | Next: regional ops callback within 4h.",
      handoff_state: "queued_regional_ops",
      ai_agent_id: AGENT_VOICE_ID,
      retrieved_knowledge: [
        { title: "Branch operations — callback scheduling", confidence: "0.91" },
        { title: "ATM withdrawal limits (retail SOP)", confidence: "0.72" },
      ],
      tool_calls: [{ name: "suggest_workflow", status: "branch_callback" }],
      disposition: { resolution: "callback", team: "Regional operations" },
      ended_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "id" }
  );
  await admin.from("voice_frontdesk_turns").insert([
    {
      tenant_id: TENANT_ID,
      session_id: vfs1,
      actor: "caller",
      language: "ur",
      text: "Assalamualaikum, branch vault reconciliation abhi tak update nahi hui.",
      confidence: "0.88",
    },
    {
      tenant_id: TENANT_ID,
      session_id: vfs1,
      actor: "assistant",
      language: "ur",
      text: "Walaikum assalam. Main aapki request note kar raha hoon aur regional operations ko callback ke liye line par laa raha hoon.",
      confidence: null,
    },
  ]);

  const run1 = "dddddddd-dddd-4ddd-8ddd-dddddddd0001";
  const run2 = "dddddddd-dddd-4ddd-8ddd-dddddddd0002";
  await admin.from("workflow_run_steps").delete().in("run_id", [run1, run2]);
  await admin.from("workflow_runs").delete().in("id", [run1, run2]);
  await admin.from("workflow_runs").insert([
    {
      id: run1,
      workflow_id: WF_CARD,
      tenant_id: TENANT_ID,
      status: "success",
      context: { demo: true },
      started_at: yesterday,
      finished_at: nowIso,
    },
    {
      id: run2,
      workflow_id: WF_IT_TICKET,
      tenant_id: TENANT_ID,
      status: "success",
      context: { demo: true },
      started_at: nowIso,
      finished_at: nowIso,
    },
  ]);

  await admin.from("audit_events").insert([
    {
      tenant_id: TENANT_ID,
      source: "seed",
      actor_label: "platform.seed",
      action: "agent.publish",
      resource_type: "ai_agent",
      resource_id: AGENT_HR_ID,
      payload: { status: "live" },
    },
    {
      tenant_id: TENANT_ID,
      source: "seed",
      actor_label: "platform.seed",
      action: "workflow.run",
      resource_type: "workflow_run",
      resource_id: run1,
      payload: { workflow_id: WF_CARD, status: "success" },
    },
  ]);

  await admin.from("live_events").insert({
    tenant_id: TENANT_ID,
    event_type: "system.seed",
    payload: { message: "Demo dataset refreshed" },
  });

  await admin.from("alerts").insert({
    tenant_id: TENANT_ID,
    severity: "warning",
    title: "Raast reconciliation queue above threshold",
    body: "Demo alert — wire to real monitoring in production.",
  });

  const { data: userList } = await admin.auth.admin.listUsers();
  const adminProfileId = userList?.users?.find((u) => u.email === ADMIN_EMAIL)?.id;
  const agentProfileId = userList?.users?.find((u) => u.email === AGENT_EMAIL)?.id;

  await admin.from("connectors").upsert(
    [
      {
        id: "dadadada-1111-4111-8111-111111111101",
        tenant_id: TENANT_ID,
        connector_type: "bank_core",
        display_name: "Core banking (CBS)",
        status: "sandbox",
        notes: "Account & card master read replicas — wire to your CBS APIs.",
      },
      {
        id: "dadadada-1111-4111-8111-111111111102",
        tenant_id: TENANT_ID,
        connector_type: "card_rail",
        display_name: "Card processor",
        status: "connected",
        notes: "Block / hotlist — mock adapter in V1.",
      },
      {
        id: "dadadada-1111-4111-8111-111111111103",
        tenant_id: TENANT_ID,
        connector_type: "raast",
        display_name: "Raast / IPS",
        status: "sandbox",
        notes: "Trace ID + settlement callbacks.",
      },
      {
        id: "dadadada-1111-4111-8111-111111111105",
        tenant_id: TENANT_ID,
        connector_type: "telephony",
        display_name: "Telephony / CCaaS",
        status: "planned",
        notes: "Stream transcripts into calls table.",
      },
      {
        id: "dadadada-1111-4111-8111-111111111106",
        tenant_id: TENANT_ID,
        connector_type: "ats",
        display_name: "ATS / hiring",
        status: "disconnected",
        notes: "Optional link to external hiring pipeline.",
      },
      {
        id: "dadadada-1111-4111-8111-111111111107",
        tenant_id: TENANT_ID,
        connector_type: "ticketing",
        display_name: "Ticketing / ITSM",
        status: "disconnected",
        notes: "Escalation and case sync.",
      },
      {
        id: "dadadada-1111-4111-8111-111111111108",
        tenant_id: TENANT_ID,
        connector_type: "siem",
        display_name: "SIEM / audit",
        status: "disconnected",
        notes: "Export live_events + audit_events via v1 API or webhook.",
      },
    ],
    { onConflict: "id" }
  );

  const DEMO_HIRE_ID = "44444444-4444-4444-8444-444444444441";
  const DEMO_HIRE_TOKEN = "55555555-5555-4555-8555-555555555555";
  await admin.from("hiring_applications").upsert(
    {
      id: DEMO_HIRE_ID,
      tenant_id: TENANT_ID,
      reference_code: "DEMO-HIRE-001",
      secure_token: DEMO_HIRE_TOKEN,
      candidate_name: "Sample Candidate",
      candidate_email: "candidate@example.com",
      stage: "documents_review",
      document_discrepancy: "Awaiting clear scan of CNIC back page.",
      offer_issued: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  const DEMO_SURVEY_ID = "66666666-6666-4666-8666-666666666661";
  await admin.from("survey_templates").upsert(
    {
      id: DEMO_SURVEY_ID,
      tenant_id: TENANT_ID,
      title: "Quarterly check-in (demo)",
      description: "Seeded for assistant / surveys demo",
      questions: [
        { id: "q1", type: "text", prompt: "What went well this month?" },
        {
          id: "q2",
          type: "choice",
          prompt: "Current workload",
          options: ["Light", "Balanced", "Heavy"],
        },
      ],
      personalization_context: {},
      created_by: adminProfileId ?? null,
    },
    { onConflict: "id" }
  );

  if (agentProfileId) {
    await admin.from("survey_assignments").upsert(
      {
        id: "77777777-7777-4777-8777-777777777771",
        tenant_id: TENANT_ID,
        template_id: DEMO_SURVEY_ID,
        assigned_profile_id: agentProfileId,
        status: "pending",
      },
      { onConflict: "id" }
    );
  }

  const DEMO_MODULE_ID = "88888888-8888-4888-8888-888888888881";
  await admin.from("course_modules").upsert(
    {
      id: DEMO_MODULE_ID,
      tenant_id: TENANT_ID,
      title: "Security awareness (demo)",
      description: "Short MCQ practice inside the assistant.",
      activities: [
        {
          type: "mcq",
          prompt: "What best describes phishing?",
          options: [
            "A bank rewards program",
            "A deceptive attempt to steal credentials",
            "A type of debit card",
          ],
          correctIndex: 1,
        },
        {
          type: "mcq",
          prompt: "If you see a suspicious transaction you should…",
          options: ["Ignore it", "Report it to the bank promptly", "Share your PIN to verify"],
          correctIndex: 1,
        },
      ],
    },
    { onConflict: "id" }
  );

  if (agentProfileId) {
    await admin.from("course_assignments").upsert(
      {
        id: "99999999-9999-4999-8999-999999999991",
        tenant_id: TENANT_ID,
        module_id: DEMO_MODULE_ID,
        profile_id: agentProfileId,
        status: "not_started",
        progress: {},
      },
      { onConflict: "id" }
    );
  }

  if (agentProfileId) {
    await admin.from("employee_attributes").upsert(
      {
        profile_id: agentProfileId,
        tenant_id: TENANT_ID,
        department: "Contact center",
        work_nature: "Customer support and escalations",
        areas_of_interest: ["coaching", "quality", "digital channels"],
        personality_notes: "Detail-oriented; prefers structured checklists.",
        performance_summary: "Strong containment; improving on Raast-related cases.",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" }
    );
  }

  // Repair: app_users without profiles (e.g. manual inserts) breaks /overview after login.
  const pool = getPool();
  for (const [email, role, name] of [
    [ADMIN_EMAIL, "admin", "Ayesha Malik"],
    [AGENT_EMAIL, "agent", "Bilal Hussain"],
  ] as const) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM public.app_users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
      [email]
    );
    const id = rows[0]?.id;
    if (!id) {
      console.warn("Seed repair: skip — no app_users row for", email);
      continue;
    }
    assertNoDbError(
      `profiles repair (${email})`,
      await admin.from("profiles").upsert(
        { id, tenant_id: TENANT_ID, role, display_name: name },
        { onConflict: "id" }
      )
    );
  }

  console.log("Seed complete. Login:", ADMIN_EMAIL, "or", AGENT_EMAIL, "password:", DEMO_PASSWORD);
  console.log(
    "Hiring demo (public /hiring-status): slug demo-bank-pk, ref DEMO-HIRE-001, token",
    DEMO_HIRE_TOKEN
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
