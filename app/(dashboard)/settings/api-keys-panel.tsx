"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

export function ApiKeysPanel({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [secret, setSecret] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function createKey(formData: FormData) {
    setBusy(true);
    setSecret(null);
    try {
      const r = await createApiKeyAction(formData);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setSecret(r.secret);
      toast.success("API key created — copy it now; it will not be shown again.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle>API keys (v1 platform)</CardTitle>
        <CardDescription>
          Bearer keys for server-to-server calls: event ingest, conversation message ingest, usage metrics, audit
          export. Scope with least privilege.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {secret && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <p className="font-semibold text-primary">Copy this secret once</p>
            <code className="mt-2 block break-all rounded bg-background p-2 text-xs">{secret}</code>
          </div>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            await createKey(fd);
            e.currentTarget.reset();
          }}
        >
          <div className="min-w-[200px] flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="key_name">
              Label
            </label>
            <Input id="key_name" name="name" placeholder="e.g. CBS batch worker" required disabled={busy} />
          </div>
          <Button type="submit" className="rounded-xl" disabled={busy}>
            Create key
          </Button>
        </form>
        <ul className="space-y-2 text-sm">
          {keys.length === 0 ? (
            <li className="text-muted-foreground">No keys yet.</li>
          ) : (
            keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium">{k.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {k.key_prefix}… · {k.revoked_at ? "revoked" : "active"}
                    {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : ""}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{(k.scopes ?? []).join(", ")}</div>
                </div>
                {!k.revoked_at && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg text-destructive"
                    onClick={async () => {
                      const fd = new FormData();
                      fd.set("id", k.id);
                      const r = await revokeApiKeyAction(fd);
                      if ("error" in r) toast.error(r.error);
                      else {
                        toast.success("Key revoked");
                        router.refresh();
                      }
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
