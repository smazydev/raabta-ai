import Link from "next/link";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import {
  BookOpen,
  Bot,
  Building2,
  Cable,
  MessageSquare,
  MessagesSquare,
  Phone,
  Plug,
  Settings,
  Share2,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { shouldShowDemoNav } from "@/lib/dashboard-nav";
import { getSessionTenant } from "@/lib/session";

const tiles = [
  {
    href: "/knowledge",
    title: "Knowledge orchestration",
    description: "Governed corpus, embeddings, and retrieval for governed agents. Policy-grounded answers from tenant-scoped sources.",
    icon: BookOpen,
  },
  {
    href: "/workflows",
    title: "Workflow automation",
    description: "Conversation → action: linear graphs with internal steps and HTTP to controlled adapters. Linked from agents and channels.",
    icon: Workflow,
  },
  {
    href: "/conversations",
    title: "Chat runtime",
    description: "Live text threads across channels. AI replies, containment, escalation, and workflow triggers in one place.",
    icon: MessagesSquare,
  },
  {
    href: "/frontdesk",
    title: "Voice front desk",
    description: "Urdu-first intake and structured handoff before human agents. Same policies and KB as chat.",
    icon: Building2,
  },
  {
    href: "/voice",
    title: "Voice control plane",
    description: "Call simulator plus session registry — transcripts, intent, retrieval, handoff, same orchestration as chat.",
    icon: Phone,
  },
  {
    href: "/channels",
    title: "Channels",
    description: "How traffic is segmented (web, app, voice, assist). Tune the mix per tenant.",
    icon: Share2,
  },
  {
    href: "/assistant",
    title: "AI copilot",
    description: "Workplace assistant with tools, RAG, and persisted sessions — operator-facing, same stack.",
    icon: Sparkles,
  },
  {
    href: "/settings",
    title: "API keys & governance",
    description: "Tenant API keys, usage metering hooks, provider profile, and escalation defaults. Wire ingress and audit from here.",
    icon: Settings,
  },
] as const;

export default async function AgentPlatformPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const showDemoNav = shouldShowDemoNav();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight">AI control plane</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Tenant-scoped <strong className="font-medium text-foreground">governed agents</strong>,{" "}
          <strong className="font-medium text-foreground">knowledge orchestration</strong>, and{" "}
          <strong className="font-medium text-foreground">workflow automation</strong> — then operate chat, voice, and
          APIs from the same deployment. No separate builder silo.
        </p>
      </div>

      <Link href="/platform/agents" className="block">
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card transition-colors hover:border-primary/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Bot className="h-5 w-5 text-primary" />
              Agent studio
            </CardTitle>
            <CardDescription>
              Configure publish state, departments, knowledge allowlists, workflow automation, citations, and handoff rules.
              Assign live agents to conversations for policy-grounded AI replies and audit-friendly operations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-sm font-semibold text-primary">Open agent builder →</span>
          </CardContent>
        </Card>
      </Link>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cable className="h-4 w-4 text-primary" />
            Connect your estate
          </CardTitle>
          <CardDescription>
            Register systems of record and ingress paths so external events and backends participate in the same
            orchestration layer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link
            href="/integrations"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary/80"
          >
            <Plug className="h-4 w-4 text-primary" />
            Integration catalog
          </Link>
          {showDemoNav ? (
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary/80"
            >
              <MessageSquare className="h-4 w-4 text-primary" />
              Client chat simulator
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="group block h-full">
            <Card className="h-full border-border bg-card transition-colors group-hover:border-primary/30 group-hover:bg-secondary/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <t.icon className="h-4 w-4 text-primary" />
                  {t.title}
                </CardTitle>
                <CardDescription className="text-pretty">{t.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-xs font-semibold text-primary group-hover:underline">Open →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
