import Link from "next/link";
import { HiringStatusClient } from "./hiring-status-client";

export default function HiringStatusPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <span className="text-sm font-bold tracking-tight">Raabta AI</span>
          <Link href="/login" className="text-xs font-medium text-primary hover:underline">
            Staff login
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 py-10">
        <HiringStatusClient defaultTenantSlug="demo-bank-pk" />
      </main>
    </div>
  );
}
