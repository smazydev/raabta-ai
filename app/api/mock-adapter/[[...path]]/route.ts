import { NextRequest, NextResponse } from "next/server";

/**
 * Demo bank adapter — HTTP workflows call this when BANK_ADAPTER_BASE_URL
 * points at the app origin + /api/mock-adapter (see README).
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path: segments = [] } = await context.params;
  const path = `/${segments.join("/")}`;
  if (path === "/v1/ping") {
    return NextResponse.json({ ok: true, service: "mock-adapter", path });
  }
  return NextResponse.json({ error: "Not found", path }, { status: 404 });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path: segments = [] } = await context.params;
  const path = `/${segments.join("/")}`;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const cardNotify = /^\/v1\/cards\/[0-9a-f-]{36}\/block-notify$/i.test(path);
  if (cardNotify) {
    return NextResponse.json({
      ok: true,
      received: body,
      path,
      message: "Mock adapter recorded block notification (demo only).",
    });
  }

  return NextResponse.json({ error: "Not found", path }, { status: 404 });
}
