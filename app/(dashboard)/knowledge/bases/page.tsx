import Link from "next/link";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createKnowledgeBaseAction } from "./actions";

export default async function KnowledgeBasesPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;
  const { data: raw } = await supabase
    .from("knowledge_bases")
    .select("id, name, description, created_at")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  const bases = dbRows<{ id: string; name: string; description: string | null; created_at: string }>(raw);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Knowledge bases</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href="/knowledge" className="text-primary hover:underline">
            ← Knowledge articles
          </Link>
        </p>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Group articles into named corpora, then map bases to governed agents via your operational workflow (voice
          agent in Settings → Twilio inbound voice, and per-conversation agent in the inbox).
        </p>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Create base</CardTitle>
          <CardDescription>Name must be unique per tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createKnowledgeBaseAction} className="space-y-3">
            <div>
              <label className="text-sm font-medium" htmlFor="kb-name">
                Name
              </label>
              <Input id="kb-name" name="name" required placeholder="e.g. Retail banking FAQ" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="kb-desc">
                Description (optional)
              </label>
              <Input id="kb-desc" name="description" placeholder="Internal note for admins" className="mt-1" />
            </div>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Your bases</CardTitle>
          <CardDescription>Assign articles when adding or editing an article.</CardDescription>
        </CardHeader>
        <CardContent>
          {bases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bases yet. Create one above.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {bases.map((b) => (
                <li key={b.id} className="rounded-lg border border-border px-3 py-2">
                  <p className="font-medium">{b.name}</p>
                  {b.description ? <p className="text-muted-foreground">{b.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
