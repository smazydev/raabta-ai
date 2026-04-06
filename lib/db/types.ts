import type { UserDbClient } from "./app-client";
import type { ServiceRoleClient } from "./service-client";

/** Shared DB access shape (user session client or service-role client). */
export type AppDbClient = UserDbClient | ServiceRoleClient;
