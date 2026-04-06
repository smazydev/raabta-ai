"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  completeCallAction,
  escalateCallAction,
  freezeCardVoiceAction,
  voiceComplaintAction,
} from "./actions";
import { runPublishedWorkflowAction } from "../workflows/run-workflow-action";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CallRow = {
  id: string;
  customer_id: string;
  status: string;
  duration_seconds: number | null;
  intent: string | null;
  summary: string | null;
  transcript: unknown;
  started_at: string;
  customer: { full_name: string } | null;
};

export function VoiceClient({
  calls,
  cards,
  manualWorkflows,
}: {
  calls: CallRow[];
  cards: { id: string; customer_id: string; last_four: string; status: string }[];
  manualWorkflows: { id: string; name: string }[];
}) {
  const [sel, setSel] = React.useState<CallRow | null>(calls[0] ?? null);
  const [busy, setBusy] = React.useState(false);

  const transcriptLines = React.useMemo(() => {
    if (!sel) return [];
    const t = sel.transcript;
    if (Array.isArray(t)) {
      return t as { sender?: string; text?: string }[];
    }
    return [];
  }, [sel]);

  const cardForCustomer = sel ? cards.find((c) => c.customer_id === sel.customer_id) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Call list</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {calls.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSel(c)}
              className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-secondary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.customer?.full_name}</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {c.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{c.intent}</p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Transcript & actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!sel ? (
            <p className="text-sm text-muted-foreground">Select a call.</p>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-secondary/20 p-4 text-sm">
                <p className="text-xs text-muted-foreground">Summary</p>
                <p>{sel.summary}</p>
              </div>
              <div className="space-y-2 text-sm">
                {transcriptLines.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No transcript on this call record. Front-desk PSTN conversations store turns under{" "}
                    <Link href="/voice/sessions" className="font-medium text-primary hover:underline">
                      Voice sessions
                    </Link>
                    .
                  </p>
                ) : (
                  transcriptLines.map((line, i) => (
                    <div key={i} className="rounded-lg border border-border/60 px-3 py-2">
                      <span className="text-[10px] font-bold uppercase text-primary">{line.sender}</span>
                      <p>{line.text}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy || manualWorkflows.length === 0}
                    render={
                      <Button size="sm" variant="secondary">
                        Run workflow
                      </Button>
                    }
                  />
                  <DropdownMenuContent>
                    {manualWorkflows.map((w) => (
                      <DropdownMenuItem
                        key={w.id}
                        onClick={async () => {
                          if (!cardForCustomer) {
                            toast.error("No card on file for this customer");
                            return;
                          }
                          setBusy(true);
                          try {
                            const r = await runPublishedWorkflowAction(w.id, {
                              callId: sel.id,
                              cardId: cardForCustomer.id,
                              customerId: sel.customer_id,
                            });
                            if (r.status === "failed") {
                              toast.error(r.errorMessage ?? "Workflow failed");
                            } else {
                              toast.success("Workflow completed");
                              window.location.reload();
                            }
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {w.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!cardForCustomer || busy}
                  onClick={async () => {
                    if (!cardForCustomer) return;
                    try {
                      await freezeCardVoiceAction(sel.id, cardForCustomer.id);
                      toast.success("Card frozen + complaint");
                      window.location.reload();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Freeze card
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await voiceComplaintAction(sel.id);
                      toast.success("Complaint created");
                      window.location.reload();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Create complaint
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await escalateCallAction(sel.id);
                      toast.success("Escalated with AI summary");
                      window.location.reload();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Escalate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await completeCallAction(sel.id);
                      toast.success("Marked complete");
                      window.location.reload();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Mark complete
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
