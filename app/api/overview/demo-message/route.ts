import { NextResponse } from "next/server";
import { sendDemoMessageAction } from "@/app/(dashboard)/overview/actions";
import { isBillingError } from "@/lib/billing/errors";

export async function POST(request: Request) {
  let body: { conversationId?: string; message?: string; language?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const conversationId = String(body.conversationId ?? "").trim();
  const message = String(body.message ?? "");
  const language = body.language;
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }

  try {
    const { reply } = await sendDemoMessageAction(conversationId, message, language);
    return NextResponse.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Message failed";
    if (isBillingError(e)) {
      return NextResponse.json({ error: msg, code: e.code }, { status: 402 });
    }
    const unauthorized = /unauthorized|no tenant/i.test(msg);
    return NextResponse.json({ error: msg }, { status: unauthorized ? 401 : 400 });
  }
}
