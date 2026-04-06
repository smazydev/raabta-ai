import { redirect } from "next/navigation";

/** Send unauthenticated users to the login page (307; POST /login is normalized via `app/(auth)/login/route.ts`). */
export async function redirectUnauthenticatedToLogin(): Promise<never> {
  redirect("/login");
}
