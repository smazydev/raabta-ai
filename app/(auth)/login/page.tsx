import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Network } from "lucide-react";
import { LoginForm } from "./login-form";

const SESSION_INVALID_MSG =
  "Your browser still had a session for an old user id (typical after wiping the database or re-seeding, when new rows get new UUIDs). That session was cleared — sign in again. If you still see this after signing in, confirm DATABASE_URL matches the DB you seeded and run npm run db:seed.";

const CONFIG_MSG =
  "Server configuration is incomplete. Set DATABASE_URL (Postgres URI; for Supabase serverless often use the transaction pooler on port 6543) and SESSION_SECRET (≥16 characters) in your host’s environment (e.g. Vercel → Project → Settings → Environment Variables), then redeploy.";

const DB_UNAVAILABLE_MSG =
  "Could not reach PostgreSQL. Confirm DATABASE_URL is correct, the database allows connections from your host’s region, and TLS settings match your provider. For TLS issues while debugging, set PG_SSL_REJECT_UNAUTHORIZED=false in server env only.";

const LOGIN_ERROR_HINTS: Record<string, string> = {
  session_invalid: SESSION_INVALID_MSG,
  no_profile: SESSION_INVALID_MSG,
  configuration: CONFIG_MSG,
  db_unavailable: DB_UNAVAILABLE_MSG,
  server_error: "Something went wrong while signing in. Try again or contact support.",
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const raw = error?.trim();
  const loginError = raw ? (LOGIN_ERROR_HINTS[raw] ?? raw) : undefined;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-[0_0_24px_rgba(16,185,129,0.25)]">
          <Network className="h-7 w-7 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            RAABTA<span className="text-primary">.AI</span>
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            AI control plane
          </p>
        </div>
      </div>
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Authorized operators only. Use credentials issued for your tenant environment.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm loginError={loginError} />
        </CardContent>
      </Card>
    </div>
  );
}
