"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ loginError }: { loginError?: string }) {
  return (
    <form action="/api/auth/login" method="post" className="space-y-4">
      {loginError ? (
        <p className="text-sm text-destructive" role="alert">
          {loginError}
        </p>
      ) : null}
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="admin@demo.raabta.ai"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full">
        Continue
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Marketing site:{" "}
        <Link
          href={process.env.NEXT_PUBLIC_LANDING_URL || "#"}
          className="text-primary hover:underline"
        >
          Raabta AI
        </Link>
      </p>
    </form>
  );
}
