import { NextResponse } from "next/server";
import { suggestAgentReply } from "@/lib/ai/pipelines";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { resolveOpenAiChatModel } from "@/lib/ai/resolve-model";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getSessionTenantForApi } from "@/lib/session";
import { chargeAfterChatCompletion, preflightAiCredits } from "@/lib/billing/credits";
import { minPreflightChatCredits } from "@/lib/billing/pricing";
import { billingErrorResponse } from "@/lib/billing/http";

export async function POST(req: Request) {
  const session = await getSessionTenantForApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOpenAiConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }

  try {
    const ai = await getTenantAiSettings(session.supabase, session.tenantId);
    if (!ai.summaries) {
      return NextResponse.json(
        { error: "AI suggested replies are disabled when summaries are off (Settings → AI automation)." },
        { status: 403 }
      );
    }
    await preflightAiCredits(session.tenantId, minPreflightChatCredits());
    const body = await req.json();
    const model = await resolveOpenAiChatModel(session.supabase, session.tenantId);
    const { text: reply, usage } = await suggestAgentReply({
      summary: String(body.summary ?? ""),
      thread: String(body.thread ?? ""),
      model,
    });
    await chargeAfterChatCompletion(session.tenantId, usage, "openai.api.suggest_reply", {}, model);
    return NextResponse.json({ reply });
  } catch (e) {
    const be = billingErrorResponse(e);
    if (be) return be;
    const msg = e instanceof Error ? e.message : "AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
