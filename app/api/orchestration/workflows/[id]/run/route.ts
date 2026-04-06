import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runWorkflowEngine } from "@/lib/orchestration/run-workflow";
import { recordAuditEvent, recordUsageEvent } from "@/lib/platform/telemetry";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }
  const tenantId = profile.tenant_id as string;

  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: string;
    callId?: string;
    cardId?: string;
    customerId?: string;
  };

  const { data: wf } = await supabase
    .from("workflows")
    .select("id, definition, enabled")
    .eq("id", workflowId)
    .eq("tenant_id", tenantId)
    .single();

  if (!wf) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  if (!wf.enabled) {
    return NextResponse.json({ error: "Workflow is disabled" }, { status: 400 });
  }

  let customerId = body.customerId;
  let channel: string | undefined;
  if (body.conversationId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("customer_id, channel")
      .eq("id", body.conversationId)
      .eq("tenant_id", tenantId)
      .single();
    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    customerId = customerId ?? (conv.customer_id as string);
    channel = conv.channel as string;
  }
  if (body.callId) {
    const { data: call } = await supabase
      .from("calls")
      .select("customer_id")
      .eq("id", body.callId)
      .eq("tenant_id", tenantId)
      .single();
    if (!call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
    customerId = customerId ?? (call.customer_id as string);
    channel = channel ?? "web_chat";
  }

  const result = await runWorkflowEngine({
    supabase,
    userId: user.id,
    tenantId,
    workflowId: wf.id as string,
    definitionRaw: wf.definition,
    context: {
      conversationId: body.conversationId,
      callId: body.callId,
      cardId: body.cardId,
      customerId,
      channel,
    },
  });

  if (result.status === "failed" && !result.runId) {
    return NextResponse.json(
      { error: result.errorMessage ?? "Failed" },
      { status: 400 }
    );
  }

  void recordUsageEvent({
    tenantId,
    eventType: "workflow.run",
    metadata: { workflow_id: workflowId, status: result.status, run_id: result.runId },
  });
  void recordAuditEvent({
    tenantId,
    source: "ui",
    action: "workflow.run",
    actorLabel: user.id,
    resourceType: "workflow",
    resourceId: workflowId,
    payload: { run_id: result.runId, status: result.status },
  });

  return NextResponse.json(result);
}
