/**
 * Reconstruct the public URL Twilio called (for signature validation behind proxies).
 */
export function publicRequestUrl(req: Request): string {
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || u.protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}

export function absolutePathOnRequest(req: Request, pathname: string, searchParams: Record<string, string>): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || "";
  const qs = new URLSearchParams(searchParams);
  const q = qs.toString();
  return `${proto}://${host}${pathname}${q ? `?${q}` : ""}`;
}
