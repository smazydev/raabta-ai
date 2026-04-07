"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Activity, BookOpen, GitBranch, MessageSquare, Pencil } from "lucide-react";
import { AgentDefinitionFields, type AgentFieldDefaults } from "./agent-fields";
import { formatYmd, formatYmdHm } from "@/lib/format-date";
import { deleteAgentAction, updateAgentAction } from "../actions";

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "live" ? "default" : status === "archived" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-[10px] uppercase tracking-wide">
      {status}
    </Badge>
  );
}

export function AgentDetailShell({
  agentMeta,
  defaults,
  workflows,
  articles,
  knowledgeBases,
  linkedArticles,
  linkedWorkflows,
  recentConversations,
  convCount,
  createdByLabel,
  updatedByLabel,
}: {
  agentMeta: {
    id: string;
    name: string;
    slug: string;
    kind: string;
    status: string;
    department: string | null;
    created_at: string;
    updated_at: string;
    published_at: string | null;
  };
  defaults: AgentFieldDefaults;
  workflows: { id: string; name: string }[];
  articles: { id: string; title: string }[];
  knowledgeBases: { id: string; name: string }[];
  linkedArticles: { id: string; title: string }[];
  linkedWorkflows: { id: string; name: string }[];
  recentConversations: {
    id: string;
    channel: string;
    summary: string | null;
    last_message_at: string;
  }[];
  convCount: number;
  createdByLabel: string | null;
  updatedByLabel: string | null;
}) {
  const channelLabel =
    agentMeta.kind === "both" ? "Chat & voice" : agentMeta.kind === "voice" ? "Voice" : "Chat";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-black tracking-tight">{agentMeta.name}</h1>
            <StatusBadge status={agentMeta.status} />
            <Badge variant="outline" className="text-[10px] uppercase">
              {channelLabel}
            </Badge>
            {agentMeta.department ? (
              <Badge variant="outline" className="font-normal">
                {agentMeta.department}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{agentMeta.slug}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Governed AI agent configuration — knowledge orchestration, workflow automation, and audit-friendly
            lifecycle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(agentMeta.kind === "voice" || agentMeta.kind === "both") && agentMeta.status !== "archived" ? (
            <Link
              href={`/assistant?new=true&agent=${encodeURIComponent(agentMeta.id)}`}
              className={cn(buttonVariants({ variant: "default" }), "no-underline")}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Open in assistant (voice)
            </Link>
          ) : null}
          <Link
            href="/conversations"
            className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Assign in conversations
          </Link>
        </div>
      </div>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="overview" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="configure" className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-2">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-border bg-card lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Lifecycle</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-mono text-xs">{formatYmd(agentMeta.created_at)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Last updated</span>
                  <span className="font-mono text-xs">{formatYmd(agentMeta.updated_at)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Published</span>
                  <span className="font-mono text-xs">{formatYmd(agentMeta.published_at)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Created by</span>
                  <span className="text-right text-xs">{createdByLabel ?? "—"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Updated by</span>
                  <span className="text-right text-xs">{updatedByLabel ?? "—"}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Activity className="h-4 w-4 text-primary" />
                  Analytics snapshot
                </CardTitle>
                <CardDescription>Operational signals for this agent (demo metrics from live assignments).</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/80 bg-secondary/20 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Assigned threads
                  </p>
                  <p className="mt-1 text-2xl font-mono font-bold">{convCount}</p>
                </div>
                <div className="rounded-xl border border-border/80 bg-secondary/20 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Linked knowledge
                  </p>
                  <p className="mt-1 text-2xl font-mono font-bold">{linkedArticles.length}</p>
                </div>
                <div className="rounded-xl border border-border/80 bg-secondary/20 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Allowed workflows
                  </p>
                  <p className="mt-1 text-2xl font-mono font-bold">{linkedWorkflows.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Attached knowledge
                </CardTitle>
                <CardDescription>Sources approved for retrieval when this agent is assigned.</CardDescription>
              </CardHeader>
              <CardContent>
                {linkedArticles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No articles linked — configure in the Configuration tab.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {linkedArticles.map((a) => (
                      <li key={a.id} className="rounded-lg border border-border/60 px-3 py-2">
                        {a.title}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4 text-primary" />
                  Attached workflows
                </CardTitle>
                <CardDescription>Automation this agent may trigger from the orchestration layer.</CardDescription>
              </CardHeader>
              <CardContent>
                {linkedWorkflows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No workflows in allowlist.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {linkedWorkflows.map((w) => (
                      <li key={w.id} className="rounded-lg border border-border/60 px-3 py-2">
                        <Link href={`/workflows/${w.id}`} className="font-medium text-primary hover:underline">
                          {w.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-4 w-4 text-primary" />
                Recent conversations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentConversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conversations currently assign this agent.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {recentConversations.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <div>
                        <Link href="/conversations" className="font-medium text-primary hover:underline">
                          {c.summary?.slice(0, 72) ?? c.id.slice(0, 8)}
                          {(c.summary?.length ?? 0) > 72 ? "…" : ""}
                        </Link>
                        <p className="text-xs text-muted-foreground">{c.channel}</p>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatYmdHm(c.last_message_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configure" className="space-y-6 pt-2">
          <form action={updateAgentAction} className="space-y-6">
            <AgentDefinitionFields
              defaults={defaults}
              workflows={workflows}
              articles={articles}
              knowledgeBases={knowledgeBases}
              hiddenId={agentMeta.id}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save configuration</Button>
              <Link href="/platform/agents" className={cn(buttonVariants({ variant: "ghost" }), "no-underline")}>
                Back to catalog
              </Link>
            </div>
          </form>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base text-destructive">Archive or remove</CardTitle>
              <CardDescription>Deleting clears assignments on conversations.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={deleteAgentAction}>
                <input type="hidden" name="id" value={agentMeta.id} />
                <Button type="submit" variant="destructive" size="sm">
                  Delete agent
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        <Link href="/platform/agents" className="text-primary hover:underline">
          ← Agent studio catalog
        </Link>
      </p>
    </div>
  );
}
