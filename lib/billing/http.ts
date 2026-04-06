import { NextResponse } from "next/server";
import { isBillingError } from "./errors";

export function billingErrorResponse(e: unknown): NextResponse | null {
  if (!isBillingError(e)) return null;
  const code = e.code;
  return NextResponse.json(
    {
      error: e.message,
      code,
      balance: "balance" in e ? e.balance : undefined,
      required: "required" in e ? e.required : undefined,
    },
    { status: 402 }
  );
}
