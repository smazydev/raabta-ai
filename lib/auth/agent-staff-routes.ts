/**
 * Bank-employee (`role !== "admin"`) dashboard paths: governed chat only.
 * Keep in sync with `AGENT_STAFF_SECTIONS` in `lib/dashboard-nav.ts`.
 */
const PREFIXES = ["/assistant"] as const;

export function isAgentStaffAllowedPath(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  return PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
