import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { resolveBearerApiKey, scopeAllows } from "@/lib/platform/api-key";
import { recordAuditEvent, recordUsageEvent } from "@/lib/platform/telemetry";

export const runtime = "nodejs";

const CHANNELS = new Set(["web_chat", "app_chat", "voice", "agent_assist"]);

/**
 * Ingest a customer (or external) message into an existing conversation or create one.
 * Auth: Bearer rk_live_… with scope `conversations:write`
 */
export async function POST(req: Request) {
  const resolved = await resolveBearerApiKey(req.headers.get("authorization"));
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scopeAllows(resolved.scopes, "conversations:write")) {
    return NextResponse.json({ error: "Missing scope: conversations:write" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    conversation_id?: string;
    customer_id?: string;
    channel?: string;
    body?: string;
    sender?: string;
  } | null;

  const text = String(body?.body ?? "").trim();
  if (!text || text.length > 32000) {
    return NextResponse.json({ error: "body required (max 32000 chars)" }, { status: 400 });
  }

  const sender = String(body?.sender ?? "customer").trim() || "customer";
  const tenantId = resolved.tenantId;
  const admin = createServiceRoleClient();

  const conversationIdIn = body?.conversation_id ? String(body.conversation_id).trim() : "";

  if (conversationIdIn) {
    const { data: conv, error: cErr } = await admin
      .from("conversations")
      .select("id, tenant_id")
      .eq("id", conversationIdIn)
      .maybeSingle();
    if (cErr || !conv || conv.tenant_id !== tenantId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { data: msg, error: mErr } = await admin
      .from("conversation_messages")
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationIdIn,
        sender,
        body: text,
      })
      .select("id")
      .single();

    if (mErr || !msg) {
      return NextResponse.json({ error: mErr?.message ?? "Insert failed" }, { status: 500 });
    }

    await admin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationIdIn)
      .eq("tenant_id", tenantId);

    await finishIngest(resolved.keyId, tenantId, conversationIdIn, msg.id as string, "append");
    return NextResponse.json({ ok: true, conversation_id: conversationIdIn, message_id: msg.id });
  }

  const customerId = String(body?.customer_id ?? "").trim();
  const channel = String(body?.channel ?? "").trim();
  if (!customerId || !CHANNELS.has(channel)) {
    return NextResponse.json(
      { error: "customer_id and channel required when conversation_id omitted (valid channel enum)" },
      { status: 400 }
    );
  }

  const { data: cust, error: custErr } = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (custErr || !cust) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      channel,
      status: "active",
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (convErr || !conv) {
    return NextResponse.json({ error: convErr?.message ?? "Could not create conversation" }, { status: 500 });
  }

  const newConvId = conv.id as string;

  const { data: msg, error: mErr } = await admin
    .from("conversation_messages")
    .insert({
      tenant_id: tenantId,
      conversation_id: newConvId,
      sender,
      body: text,
    })
    .select("id")
    .single();

  if (mErr || !msg) {
    return NextResponse.json({ error: mErr?.message ?? "Insert failed" }, { status: 500 });
  }

  await finishIngest(resolved.keyId, tenantId, newConvId, msg.id as string, "create");
  return NextResponse.json({ ok: true, conversation_id: newConvId, message_id: msg.id });
}

async function finishIngest(
  keyId: string,
  tenantId: string,
  conversationId: string,
  messageId: string,
  mode: "append" | "create"
) {
  await recordUsageEvent({
    tenantId,
    eventType: "api.v1.conversations.messages",
    metadata: { mode, conversation_id: conversationId },
  });
  await recordAuditEvent({
    tenantId,
    source: "api",
    action: "conversations.message_ingest",
    actorLabel: `api_key:${keyId.slice(0, 8)}`,
    resourceType: "conversation_message",
    resourceId: messageId,
    payload: { conversation_id: conversationId, mode },
  });
}
