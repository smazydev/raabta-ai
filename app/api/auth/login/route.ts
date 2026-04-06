import { NextRequest, NextResponse } from "next/server";
import { authenticateAppUser } from "@/lib/auth/authenticate-app-user";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { signSessionToken } from "@/lib/auth/jwt";
import { getSessionCookieOptions } from "@/lib/auth/session-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const result = await authenticateAppUser(email, password);
  const base = new URL(request.url);

  if (!result.ok) {
    const login = new URL("/login", base.origin);
    login.searchParams.set("error", result.message);
    // 303 so the browser does not repeat POST on /login (307 would preserve POST).
    return NextResponse.redirect(login, 303);
  }

  const token = await signSessionToken(result.userId, result.email);
  const appProfile = await loadAppProfileByUserId(result.userId);
  const landingPath = appProfile?.role === "admin" ? "/overview" : "/assistant";
  // 200 + meta refresh so the browser commits Set-Cookie before navigating; some clients
  // follow a 303 before the session cookie is stored, so the first GET looked logged out.
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${landingPath}"></head><body></body></html>`;
  const res = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
  return res;
}
