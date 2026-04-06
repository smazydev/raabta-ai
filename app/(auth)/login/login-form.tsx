import Link from "next/link";

/** Server-only login form (plain HTML) — keeps the /login route free of extra client JS. */
export function LoginForm({ loginError }: { loginError?: string }) {
  const inputClassName =
    "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";
  const buttonClassName =
    "inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary px-2.5 text-sm font-medium whitespace-nowrap text-primary-foreground outline-none transition-all select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

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
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="admin@demo.raabta.ai"
          className={inputClassName}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClassName}
        />
      </div>
      <button type="submit" className={buttonClassName}>
        Continue
      </button>
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
