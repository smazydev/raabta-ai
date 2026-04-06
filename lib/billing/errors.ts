export class BillingInsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS" as const;

  constructor(
    readonly balance: number,
    readonly required: number
  ) {
    super(
      `Insufficient AI credits. Balance ${balance.toFixed(2)}, required ${required.toFixed(2)}. Add credits in Settings → Billing or enable pay-as-you-go.`
    );
    this.name = "BillingInsufficientCreditsError";
  }
}

export class BillingPaygDebtCapError extends Error {
  readonly code = "PAYG_DEBT_CAP" as const;

  constructor(readonly balance: number, readonly required: number) {
    super(
      `AI credit pay-as-you-go debt limit reached. Balance ${balance.toFixed(2)}, required ${required.toFixed(2)}.`
    );
    this.name = "BillingPaygDebtCapError";
  }
}

export function isBillingError(e: unknown): e is BillingInsufficientCreditsError | BillingPaygDebtCapError {
  return e instanceof BillingInsufficientCreditsError || e instanceof BillingPaygDebtCapError;
}
