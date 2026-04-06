import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/db/service-client";
import { resolvePostgresConnectionString } from "@/lib/db/connection-string";

export const runtime = "nodejs";

/** Public candidate lookup: reference + secure token only. Same 404 for any miss (enumeration-safe). */
export async function POST(req: Request) {
  if (!resolvePostgresConnectionString()) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const body = (await req.json()) as {
    tenant_slug?: string;
    reference_code?: string;
    secure_token?: string;
  };
  const tenant_slug = String(body.tenant_slug ?? "").trim();
  const reference_code = String(body.reference_code ?? "").trim();
  const secure_token = String(body.secure_token ?? "").trim();

  if (!tenant_slug || !reference_code || !secure_token) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(secure_token)) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("lookup_hiring_application", {
    p_tenant_slug: tenant_slug,
    p_reference_code: reference_code,
    p_secure_token: secure_token,
  });

  if (error || data == null) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  return NextResponse.json({ found: true, application: data });
}
