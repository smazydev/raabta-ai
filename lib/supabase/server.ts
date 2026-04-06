import { createUserClient } from "@/lib/db/app-client";

/** @deprecated Prefer `createUserClient` from `@/lib/db/app-client`. Kept for minimal churn. */
export async function createClient() {
  return createUserClient();
}
