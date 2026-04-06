import Link from "next/link";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { createAgentAction } from "../actions";
import { AgentDefinitionFields, type AgentFieldDefaults } from "../_components/agent-fields";

const emptyDefaults: AgentFieldDefaults = {
  name: "",
  slug: "",
  kind: "chat",
  status: "draft",
  department: "",
  description: "",
  instructions: "",
  response_style: "",
  escalation_target_team: "",
  model_placeholder: "",
  citations_required: false,
  human_handoff_enabled: true,
  agent_assist_enabled: false,
  workflow_id: "",
  selectedArticleIds: [],
  selectedKnowledgeBaseIds: [],
  selectedWorkflowIds: [],
};

export default async function NewAgentPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;
  const { data: wfRaw } = await supabase
    .from("workflows")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  const workflows = dbRows<{ id: string; name: string }>(wfRaw);

  const { data: artRaw } = await supabase
    .from("knowledge_articles")
    .select("id, title")
    .eq("tenant_id", tenantId)
    .order("title", { ascending: true });
  const articles = dbRows<{ id: string; title: string }>(artRaw);

  const { data: kbRaw } = await supabase
    .from("knowledge_bases")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  const knowledgeBases = dbRows<{ id: string; name: string }>(kbRaw);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">New governed agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href="/platform/agents" className="text-primary hover:underline">
            ← Agent studio catalog
          </Link>
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Configure a tenant-scoped AI service: channels, knowledge allowlist, workflow automation, and handoff rules.
          Publish when ready for production conversations.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Definition</CardTitle>
          <CardDescription>Slug is unique per tenant and stable for APIs and audit trails.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAgentAction} className="space-y-6">
            <AgentDefinitionFields
              defaults={emptyDefaults}
              workflows={workflows}
              articles={articles}
              knowledgeBases={knowledgeBases}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Create agent</Button>
              <Link href="/platform/agents" className={cn(buttonVariants({ variant: "ghost" }), "no-underline")}>
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
