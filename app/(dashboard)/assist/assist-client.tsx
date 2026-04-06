"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateAssistPackAction } from "./actions";

type Item = {
  type: "conversation";
  id: string;
  title: string;
  summary: string | null;
  intent: string | null;
  customer: { full_name: string; account_number: string | null } | null;
};

type SummaryRow = {
  id: string;
  summary: string;
  suggested_reply: string | null;
  next_actions: unknown;
  conversation_id: string | null;
  complaint_id: string | null;
  created_at: string;
};

export function AssistClient({
  items,
  summaries,
  openAiConfigured,
  aiSummariesEnabled,
}: {
  items: Item[];
  summaries: SummaryRow[];
  openAiConfigured: boolean;
  aiSummariesEnabled: boolean;
}) {
  const canAiAssist = openAiConfigured && aiSummariesEnabled;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [suggested, setSuggested] = React.useState<Record<string, string>>({});
  const [packs, setPacks] = React.useState<Record<string, { summary: string; suggestedReply: string }>>({});

  async function suggestFor(item: Item) {
    setBusy(item.id);
    try {
      const res = await fetch("/api/ai/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: item.summary ?? "",
          thread: `${item.intent ?? ""}\n${item.summary ?? ""}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSuggested((s) => ({ ...s, [item.id]: data.reply }));
      toast.success("Suggested reply ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function fullPackFor(item: Item) {
    setBusy(`pack:${item.id}`);
    try {
      const r = await generateAssistPackAction(item.id);
      setPacks((p) => ({
        ...p,
        [item.id]: { summary: r.summary, suggestedReply: r.suggestedReply },
      }));
      setSuggested((s) => ({ ...s, [item.id]: r.suggestedReply }));
      toast.success("Summary and draft saved to assist history");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Active escalations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No escalated conversations.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-xs font-bold uppercase text-primary">{item.title}</p>
                <p className="mt-1 text-sm font-semibold">{item.customer?.full_name}</p>
                <p className="mt-2 text-sm text-muted-foreground">{item.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy === item.id || busy === `pack:${item.id}` || !canAiAssist}
                    title={
                      !openAiConfigured
                        ? "Configure OPENAI_API_KEY on the server"
                        : !aiSummariesEnabled
                          ? "Enable AI summaries in Settings → AI automation"
                          : undefined
                    }
                    onClick={() => suggestFor(item)}
                  >
                    {busy === item.id ? "Generating…" : "Suggested reply"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === item.id || busy === `pack:${item.id}` || !canAiAssist}
                    title={
                      !openAiConfigured
                        ? "Configure OPENAI_API_KEY on the server"
                        : !aiSummariesEnabled
                          ? "Enable AI summaries in Settings → AI automation"
                          : undefined
                    }
                    onClick={() => fullPackFor(item)}
                  >
                    {busy === `pack:${item.id}` ? "OpenAI pack…" : "Summary + save draft"}
                  </Button>
                </div>
                {packs[item.id] ? (
                  <div className="mt-3 space-y-2 rounded-lg bg-background/80 p-3 text-xs">
                    <p className="font-semibold text-primary">Handoff summary</p>
                    <pre className="whitespace-pre-wrap text-muted-foreground">{packs[item.id].summary}</pre>
                  </div>
                ) : null}
                {suggested[item.id] ? (
                  <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-background/80 p-3 text-xs">
                    {suggested[item.id]}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Recent AI handoff summaries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {summaries.length === 0 ? (
            <p className="text-muted-foreground">No summaries yet.</p>
          ) : (
            summaries.map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {new Date(s.created_at).toLocaleString()}
                </p>
                <p className="mt-2">{s.summary}</p>
                {s.suggested_reply ? (
                  <p className="mt-2 text-xs text-primary">Draft: {s.suggested_reply}</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
