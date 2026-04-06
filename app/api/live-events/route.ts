import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/db/app-client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant_id");
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  }

  const db = await createUserClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: pErr } = await db
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (pErr || !profile || profile.tenant_id !== tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: events, error: eErr } = await db
    .from("live_events")
    .select("id, event_type, payload, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (eErr) {
    return NextResponse.json({ error: eErr.message }, { status: 500 });
  }

  return NextResponse.json({ events: events ?? [] });
}
