"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Ev = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export function LiveFeed({ tenantId, initial }: { tenantId: string; initial: Ev[] }) {
  const [events, setEvents] = React.useState<Ev[]>(initial);

  React.useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/live-events?tenant_id=${encodeURIComponent(tenantId)}`,
          { credentials: "same-origin" }
        );
        if (!res.ok || stopped) return;
        const json = (await res.json()) as { events?: Ev[] };
        if (json.events) setEvents(json.events.slice(0, 50));
      } catch {
        /* ignore transient poll errors */
      }
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [tenantId]);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">Live event stream</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[480px] space-y-2 overflow-y-auto text-sm">
        {events.map((e) => (
          <div key={e.id} className="rounded-lg border border-border px-3 py-2 font-mono text-xs">
            <span className="text-primary">{e.event_type}</span>{" "}
            <span className="text-muted-foreground">
              {new Date(e.created_at).toLocaleTimeString()}
            </span>
            <pre className="mt-1 whitespace-pre-wrap text-[11px] text-foreground/80">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
