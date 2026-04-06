"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Network, Menu, X, LogOut, User, Sun, Moon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getDashboardNavSections } from "@/lib/dashboard-nav";

export type AppShellProps = {
  children: React.ReactNode;
  displayName: string;
  role: string;
  signOut: () => Promise<void>;
  /** Shown as primary product title (e.g. settings.app_name) */
  workspaceName: string;
  /** Organization / tenant display name */
  tenantName: string;
  isAdmin: boolean;
  showDemoNav: boolean;
  deploymentLabel: string;
};

export function AppShell({
  children,
  displayName,
  role,
  signOut,
  workspaceName,
  tenantName,
  isAdmin,
  showDemoNav,
  deploymentLabel,
}: AppShellProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(true);
  const [mounted, setMounted] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());

  const navSections = React.useMemo(
    () => getDashboardNavSections({ showDemoNav, isAdmin }),
    [showDemoNav, isAdmin]
  );

  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background font-sans text-foreground">
      <aside
        className={cn(
          "relative z-20 flex min-h-0 flex-col border-r border-border bg-card shadow-[10px_0_30px_rgba(0,0,0,0.2)] transition-all duration-300",
          open ? "w-72" : "w-20"
        )}
      >
        <div className="flex shrink-0 items-start gap-3 p-6 pb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary shadow-[0_0_20px_rgba(16,185,129,0.25)]">
            <Network className="h-6 w-6 text-primary-foreground" />
          </div>
          {open && (
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold leading-tight tracking-tight text-foreground">
                {workspaceName}
              </h1>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                AI control plane
              </p>
              <p className="mt-1 truncate text-[10px] text-muted-foreground">{tenantName}</p>
              <p className="mt-1.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/80">
                Powered by Aizaz Studio
              </p>
            </div>
          )}
        </div>
        <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden px-3 py-2">
          <nav className="space-y-5 pb-4">
            {navSections.map((section) => (
              <div key={section.id}>
                {open && (
                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    {section.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={!open ? item.label : undefined}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition-all duration-200",
                          active
                            ? "border-primary/15 bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                        )}
                      >
                        <item.icon className={cn("h-[17px] w-[17px] shrink-0", active ? "text-primary" : "")} />
                        {open && <span className="truncate">{item.label}</span>}
                        {active && open && (
                          <motion.div
                            layoutId="nav-active"
                            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            transition={{ type: "spring", stiffness: 380, damping: 30 }}
                          />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
        <div className="shrink-0 border-t border-border bg-secondary/20 p-4">
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary/50",
              !open && "justify-center"
            )}
          >
            <Avatar className="h-9 w-9 border border-border">
              <AvatarFallback>
                <User className="h-4 w-4 text-muted-foreground" />
              </AvatarFallback>
            </Avatar>
            {open && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {role}
                </p>
              </div>
            )}
          </div>
          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              className={cn(
                "mt-3 w-full rounded-lg text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                !open && "px-0"
              )}
            >
              <LogOut className="h-4 w-4" />
              {open && <span className="ml-2">Sign out</span>}
            </Button>
          </form>
        </div>
      </aside>
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <header className="z-10 flex h-[4.25rem] shrink-0 items-center justify-between border-b border-border bg-card/60 px-5 backdrop-blur-md md:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-4 md:gap-6">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen(!open)}
              className="shrink-0 rounded-lg text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
              aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div className="hidden min-w-0 flex-col sm:flex">
              <span className="truncate text-sm font-semibold text-foreground">{tenantName}</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Orchestration &amp; governance
              </span>
            </div>
            <Separator orientation="vertical" className="hidden h-8 bg-border md:block" />
            <Badge
              variant="outline"
              className="hidden shrink-0 border-border bg-secondary/40 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline-flex"
            >
              {deploymentLabel}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-3 md:gap-4">
            <div className="hidden text-right sm:block">
              <div className="font-mono text-xs font-semibold tabular-nums text-foreground">
                {now.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })}
              </div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
              </div>
            </div>
            <Separator orientation="vertical" className="hidden h-8 bg-border sm:block" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-lg text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {!mounted ? (
                <Moon className="h-5 w-5" />
              ) : theme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
