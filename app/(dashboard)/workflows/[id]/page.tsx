import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { notFound } from "next/navigation";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { WorkflowEditClient } from "../workflow-edit-client";

type PageProps = { params: Promise<{ id: string }> };

export default async function WorkflowDetailPage({ params }: PageProps) {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { id } = await params;
  const { supabase, tenantId, role } = session;
  const isAdmin = role === "admin";

  const { data: workflow } = await supabase
    .from("workflows")
    .select(
      "id, name, description, enabled, trigger_type, trigger_config, channels, definition, version, sort_order, slug, category, created_at, updated_at"
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (!workflow) notFound();

  const { data: runsRaw } = await supabase
    .from("workflow_runs")
    .select("id, status, started_at, finished_at, error_message")
    .eq("workflow_id", id)
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(40);
  const runList = dbRows<{
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    error_message: string | null;
  }>(runsRaw);
  const runIds = runList.map((r) => r.id);
  const runStepsByRunId: Record<
    string,
    { id: string; node_id: string; node_type: string; status: string; created_at: string }[]
  > = {};
  if (runIds.length) {
    const { data: stepsRaw } = await supabase
      .from("workflow_run_steps")
      .select("id, run_id, node_id, node_type, status, created_at")
      .in("run_id", runIds)
      .order("created_at", { ascending: true });
    const steps = dbRows<{
      id: string;
      run_id: string;
      node_id: string;
      node_type: string;
      status: string;
      created_at: string;
    }>(stepsRaw);
    for (const s of steps) {
      const rid = s.run_id;
      if (!runStepsByRunId[rid]) runStepsByRunId[rid] = [];
      runStepsByRunId[rid].push({
        id: s.id,
        node_id: s.node_id,
        node_type: s.node_type,
        status: s.status,
        created_at: s.created_at,
      });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Edit workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Linear graph only in V1 — one <code className="text-xs">trigger_manual</code> and a chain of
          steps.
        </p>
      </div>
      <WorkflowEditClient
        workflow={{
          id: workflow.id as string,
          name: workflow.name as string,
          description: (workflow.description as string | null) ?? null,
          enabled: Boolean(workflow.enabled),
          trigger_type: workflow.trigger_type as string,
          trigger_config: (workflow.trigger_config as Record<string, unknown> | null) ?? {},
          channels: (workflow.channels as string[] | null) ?? [],
          definition: workflow.definition,
          sort_order: (workflow.sort_order as number) ?? 0,
          category: (workflow.category as string | null) ?? null,
        }}
        runs={runList.map((r) => ({
          id: r.id as string,
          status: r.status as string,
          started_at: r.started_at as string,
          finished_at: (r.finished_at as string | null) ?? null,
          error_message: (r.error_message as string | null) ?? null,
        }))}
        runStepsByRunId={runStepsByRunId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
