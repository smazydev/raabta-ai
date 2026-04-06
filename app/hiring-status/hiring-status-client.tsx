"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function HiringStatusClient({ defaultTenantSlug }: { defaultTenantSlug: string }) {
  const [tenantSlug, setTenantSlug] = React.useState(defaultTenantSlug);
  const [referenceCode, setReferenceCode] = React.useState("");
  const [secureToken, setSecureToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setNotFound(false);
    try {
      const res = await fetch("/api/public/hiring-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_slug: tenantSlug.trim(),
          reference_code: referenceCode.trim(),
          secure_token: secureToken.trim(),
        }),
      });
      const data = (await res.json()) as { found?: boolean; application?: Record<string, unknown> };
      if (!res.ok || !data.found) {
        setNotFound(true);
        return;
      }
      setResult(data.application ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-lg border-border bg-card shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Application status</CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter the reference code and secure token you received. We never show partial matches.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="tenant_slug">
              Organization code
            </label>
            <Input
              id="tenant_slug"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              autoComplete="off"
              placeholder="e.g. demo-bank-pk"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="ref">
              Reference code
            </label>
            <Input
              id="ref"
              value={referenceCode}
              onChange={(e) => setReferenceCode(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="token">
              Secure token (UUID)
            </label>
            <Input
              id="token"
              value={secureToken}
              onChange={(e) => setSecureToken(e.target.value)}
              required
              autoComplete="off"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </div>
          <Button type="submit" className="w-full rounded-xl gap-2" disabled={busy}>
            <Search className="h-4 w-4" />
            {busy ? "Checking…" : "Check status"}
          </Button>
        </form>
        {notFound && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            No record found. Check your details or contact HR.
          </p>
        )}
        {result && (
          <div className="mt-6 space-y-3 rounded-xl border border-border bg-secondary/30 p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{String(result.candidate_name ?? "")}</span>
              <Badge>{String(result.stage ?? "")}</Badge>
            </div>
            {result.document_discrepancy ? (
              <p className="text-amber-700 dark:text-amber-400">
                <span className="font-medium">Documents: </span>
                {String(result.document_discrepancy)}
              </p>
            ) : (
              <p className="text-muted-foreground">No document issues on file.</p>
            )}
            <p>
              <span className="font-medium">Offer issued: </span>
              {result.offer_issued ? "Yes" : "Not yet"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
