import { SESSION_MAX_AGE_SEC } from "./session-constants";

/** Options for `raabta_session` — shared by Route Handlers and `cookies().set`. */
export function getSessionCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  };
}
