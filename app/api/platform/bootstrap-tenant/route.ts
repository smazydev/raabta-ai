import { NextResponse } from "next/server";
import { bootstrapTenant } from "@/lib/platform/create-tenant";

export const runtime = "nodejs";

/**
 * One-shot tenant + admin provisioning. Protected by PLATFORM_BOOTSTRAP_SECRET (ops / automation only).
 * Prefer `npx tsx scripts/create-tenant.ts` for local use.
 */
export async function POST(req: Request) {
  const expected = process.env.PLATFORM_BOOTSTRAP_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: "Bootstrap disabled (set PLATFORM_BOOTSTRAP_SECRET)" }, { status: 503 });
  }
  const provided = req.headers.get("x-platform-bootstrap-secret");
  if (provided !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    slug?: string;
    admin_email?: string;
    admin_password?: string;
    admin_display_name?: string;
  } | null;

  const name = String(body?.name ?? "").trim();
  const slug = String(body?.slug ?? "").trim();
  const adminEmail = String(body?.admin_email ?? "").trim();
  const adminPassword = String(body?.admin_password ?? "");
  const adminDisplayName = body?.admin_display_name != null ? String(body.admin_display_name).trim() : undefined;

  if (!name || !slug || !adminEmail || adminPassword.length < 8) {
    return NextResponse.json(
      { error: "name, slug, admin_email, admin_password (min 8 chars) required" },
      { status: 400 }
    );
  }

  try {
    const out = await bootstrapTenant({
      name,
      slug,
      adminEmail,
      adminPassword,
      adminDisplayName,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bootstrap failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
