import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { generateConversationReply, streamConversationReply } from "@/lib/ai/pipelines";
import {
  loadConversationReplyContext,
  persistConversationAiReply,
} from "@/lib/ai/conversation-reply-context";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getSessionTenantForApi } from "@/lib/session";
import { chargeAfterChatCompletion, preflightAiCredits } from "@/lib/billing/credits";
import { minPreflightChatCredits } from "@/lib/billing/pricing";
import { billingErrorResponse } from "@/lib/billing/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSessionTenantForApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOpenAiConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }

  const { supabase, tenantId } = session;
  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.autoReply) {
    return NextResponse.json(
      { error: "AI replies are turned off for this tenant (Settings → AI automation)." },
      { status: 403 }
    );
  }

  let body: { conversationId?: string; language?: string; stream?: boolean };
  try {
    body = (await req.json()) as { conversationId?: string; language?: string; stream?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  try {
    await preflightAiCredits(tenantId, minPreflightChatCredits());
    const loaded = await loadConversationReplyContext(supabase, tenantId, conversationId, body.language);

    if (!body.stream) {
      const { reply, usage } = await generateConversationReply(loaded);
      await chargeAfterChatCompletion(
        tenantId,
        usage,
        "openai.ui.conversation_reply",
        { conversationId },
        loaded.model
      );
      const { messageId } = await persistConversationAiReply(supabase, tenantId, conversationId, reply);
      revalidatePath("/conversations");
      return NextResponse.json({ reply, messageId });
    }

    const encoder = new TextEncoder();
    const sse = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const { reply, usage } = await streamConversationReply({
            ...loaded,
            onDelta: (text) => controller.enqueue(sse({ type: "delta", text })),
          });
          await chargeAfterChatCompletion(
            tenantId,
            usage,
            "openai.ui.conversation_reply",
            { conversationId },
            loaded.model
          );
          const { messageId } = await persistConversationAiReply(supabase, tenantId, conversationId, reply);
          revalidatePath("/conversations");
          controller.enqueue(sse({ type: "done", reply, messageId }));
          controller.close();
        } catch (e) {
          const be = billingErrorResponse(e);
          if (be) {
            const j = (await be.json()) as Record<string, unknown>;
            controller.enqueue(
              sse({
                type: "error",
                status: be.status,
                error: String(j.error ?? "Billing error"),
                code: j.code,
                balance: j.balance,
                required: j.required,
              })
            );
          } else {
            const msg = e instanceof Error ? e.message : "AI error";
            controller.enqueue(sse({ type: "error", status: 500, error: msg }));
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const be = billingErrorResponse(e);
    if (be) return be;
    const msg = e instanceof Error ? e.message : "AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
