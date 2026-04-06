"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { purchasePaygCreditsAction, updateTenantBillingPlanAction } from "./actions";
import type { TenantBillingWallet } from "@/lib/billing/credits";

export function BillingPanel({ wallet }: { wallet: TenantBillingWallet | null }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  if (!wallet) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Billing &amp; AI credits</CardTitle>
          <CardDescription>
            Run migrations including <code className="text-xs">20260407130000_tenant_billing_credits.sql</code>{" "}
            to enable the credit wallet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const bal = Number(wallet.credit_balance);
  const inc = Number(wallet.included_credits_monthly);
  const base = Number(wallet.base_platform_fee_usd);
  const cpu = Number(wallet.credits_per_usd_payg);

  async function buyCredits(formData: FormData) {
    setBusy(true);
    try {
      const r = await purchasePaygCreditsAction(formData);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success(`Added ${r.credits_added.toLocaleString()} credits · balance ${r.new_balance.toFixed(2)}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">Billing &amp; AI credits</CardTitle>
        <CardDescription>
          Platform fee is informational; included credits refill each billing period. When balance runs out, enable
          pay-as-you-go or purchase credits (simulated Stripe top-up for demos).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-xs font-medium text-muted-foreground">Current balance</p>
          <p className="text-3xl font-black tabular-nums text-primary">{bal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Credits deduct from chat, embeddings, TTS, assistant, and voice front-desk OpenAI calls (token-weighted).
          </p>
        </div>

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await updateTenantBillingPlanAction(new FormData(e.currentTarget));
              toast.success("Billing plan updated");
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <h4 className="text-sm font-semibold">Plan</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="included_credits_monthly">
                Included credits / period
              </label>
              <Input
                id="included_credits_monthly"
                name="included_credits_monthly"
                type="number"
                min={0}
                step={1000}
                defaultValue={inc}
                disabled={busy}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="base_platform_fee_usd">
                Base platform fee (USD, reference)
              </label>
              <Input
                id="base_platform_fee_usd"
                name="base_platform_fee_usd"
                type="number"
                min={0}
                step={1}
                defaultValue={base}
                disabled={busy}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="credits_per_usd_payg">
                Credits per $1 (PAYG)
              </label>
              <Input
                id="credits_per_usd_payg"
                name="credits_per_usd_payg"
                type="number"
                min={1}
                step={100}
                defaultValue={cpu}
                disabled={busy}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="payg_max_debt">
                PAYG max debt (credits, empty = unlimited)
              </label>
              <Input
                id="payg_max_debt"
                name="payg_max_debt"
                type="number"
                min={0}
                step={1000}
                placeholder="empty = unlimited"
                defaultValue={wallet.payg_max_debt_credits != null ? String(wallet.payg_max_debt_credits) : ""}
                disabled={busy}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="payg_enabled" defaultChecked={wallet.payg_enabled} disabled={busy} />
            Allow pay-as-you-go (negative balance up to cap when set)
          </label>
          <Button type="submit" disabled={busy} className="rounded-xl">
            Save plan
          </Button>
        </form>

        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-semibold">Simulate PAYG purchase</h4>
          <p className="mb-2 text-xs text-muted-foreground">
            Adds credits at your configured rate (no real payment — wire Stripe in production).
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await buyCredits(new FormData(e.currentTarget));
            }}
          >
            <div className="min-w-[120px]">
              <label className="text-xs text-muted-foreground" htmlFor="purchase_usd">
                USD
              </label>
              <Input id="purchase_usd" name="purchase_usd" type="number" min={1} step={1} placeholder="100" disabled={busy} />
            </div>
            <Button type="submit" variant="secondary" disabled={busy} className="rounded-xl">
              Add credits
            </Button>
          </form>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Period: {new Date(wallet.billing_period_start).toISOString().slice(0, 10)} →{" "}
          {new Date(wallet.billing_period_end).toISOString().slice(0, 10)} ({wallet.billing_period_months} mo steps).
        </p>
      </CardContent>
    </Card>
  );
}
