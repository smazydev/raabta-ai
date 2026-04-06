import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";

function isDocumentNavigation(request: NextRequest): boolean {
  const m = request.method;
  return m === "GET" || m === "HEAD";
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // `redirect("/login")` uses 307; RSC/action POSTs can follow with POST /login. Normalize to GET.
  if (path === "/login" && request.method === "POST") {
    return NextResponse.redirect(request.nextUrl.clone(), 303);
  }

  const response = NextResponse.next({ request });

  if (path.startsWith("/api")) {
    return response;
  }

  // Gate on cookie presence only. JWT is verified in Route Handlers / RSC (`getUser`); Edge
  // middleware often lacks a reliable `SESSION_SECRET` at runtime, which would falsely
  // treat valid logins as logged out.
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  const isLogin = path === "/login";
  const isAuthCallback = path.startsWith("/auth");
  const isHiringPublic = path.startsWith("/hiring-status");
  const isPublic = isLogin || isAuthCallback || isHiringPublic;

  // Only gate *page loads* (GET/HEAD). Server Actions POST to the same URL as the page;
  // if we 307 them to /login, the browser repeats POST on /login (broken). Non-GET
  // requests must be authorized inside Route Handlers / server actions instead.
  if (!hasSessionCookie && path !== "/" && !isPublic && isDocumentNavigation(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Only bounce "/" → "/overview" when already signed in. Do not redirect away from
  // "/login": if the session cookie is valid but `profiles` is missing or has no
  // `tenant_id`, dashboard pages call `redirect("/login")` and would otherwise loop
  // forever with this middleware sending login back to overview.
  if (hasSessionCookie && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    return NextResponse.redirect(url);
  }

  if (!hasSessionCookie && path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
