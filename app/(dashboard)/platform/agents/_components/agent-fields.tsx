import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export type AgentFieldDefaults = {
  name: string;
  slug: string;
  kind: string;
  status: string;
  department: string;
  description: string;
  instructions: string;
  response_style: string;
  escalation_target_team: string;
  model_placeholder: string;
  citations_required: boolean;
  human_handoff_enabled: boolean;
  agent_assist_enabled: boolean;
  workflow_id: string;
  selectedArticleIds: string[];
  selectedKnowledgeBaseIds: string[];
  selectedWorkflowIds: string[];
};

const selectCls =
  "mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
const textareaCls = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const multiCls =
  "mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm min-h-[120px]";

export function AgentDefinitionFields({
  defaults,
  workflows,
  articles,
  knowledgeBases,
  hiddenId,
}: {
  defaults: AgentFieldDefaults;
  workflows: { id: string; name: string }[];
  articles: { id: string; title: string }[];
  knowledgeBases: { id: string; name: string }[];
  hiddenId?: string;
}) {
  return (
    <div className="space-y-6">
      {hiddenId ? <input type="hidden" name="id" value={hiddenId} /> : null}

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Identity &amp; lifecycle</CardTitle>
          <CardDescription>How this governed agent appears in routing, audit, and assignment surfaces.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="name">
                Display name
              </label>
              <Input id="name" name="name" required defaultValue={defaults.name} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="slug">
                Slug
              </label>
              <Input id="slug" name="slug" defaultValue={defaults.slug} className="mt-1 font-mono text-sm" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium" htmlFor="kind">
                Channel coverage
              </label>
              <select id="kind" name="kind" className={selectCls} defaultValue={defaults.kind}>
                <option value="chat">Chat</option>
                <option value="voice">Voice</option>
                <option value="both">Chat &amp; voice</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Create multiple agents (e.g. HR voice, Ops voice). <strong className="font-medium text-foreground">Voice</strong>{" "}
                and <strong className="font-medium text-foreground">Chat &amp; voice</strong> unlock the Workplace assistant
                microphone with OpenAI Realtime, server tools, and the same knowledge bases / articles you attach below.
                Urdu and English are always supported; Sindhi/Pashto follow deployment flags.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="status">
                Publish state
              </label>
              <select id="status" name="status" className={selectCls} defaultValue={defaults.status}>
                <option value="draft">Draft</option>
                <option value="live">Live</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="department">
                Department / use case
              </label>
              <select id="department" name="department" className={selectCls} defaultValue={defaults.department}>
                <option value="">— Select —</option>
                <option value="HR">HR</option>
                <option value="IT">IT</option>
                <option value="Operations">Operations</option>
                <option value="Compliance">Compliance</option>
                <option value="Support">Support</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="description">
              Description
            </label>
            <Input id="description" name="description" defaultValue={defaults.description} className="mt-1" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Instructions &amp; tone</CardTitle>
          <CardDescription>System instructions and response posture for policy-grounded replies.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="instructions">
              System instructions
            </label>
            <textarea
              id="instructions"
              name="instructions"
              rows={8}
              className={textareaCls}
              defaultValue={defaults.instructions}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="response_style">
                Response style / tone
              </label>
              <Input
                id="response_style"
                name="response_style"
                placeholder="e.g. Formal, concise, cite articles"
                defaultValue={defaults.response_style}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="escalation_target_team">
                Escalation target team
              </label>
              <Input
                id="escalation_target_team"
                name="escalation_target_team"
                placeholder="e.g. L2 Digital Banking"
                defaultValue={defaults.escalation_target_team}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="model_placeholder">
              OpenAI chat model override (optional)
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Use a <strong className="font-medium text-foreground">label</strong> for humans (spaces OK), or a real
              model id such as <code className="rounded bg-secondary px-1">gpt-5.4-mini</code> to route this
              agent&apos;s chat to that model. Otherwise the tenant default in Settings applies. Execution stays
              server-side.
            </p>
            <Input
              id="model_placeholder"
              name="model_placeholder"
              placeholder="e.g. gpt-5.4-mini or Tenant note — prod mini"
              defaultValue={defaults.model_placeholder}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Governance &amp; handoff</CardTitle>
          <CardDescription>Citations, human handoff, and agent-assist surfaces.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name="citations_required"
              defaultChecked={defaults.citations_required}
              className="rounded border-input"
            />
            <span>Citations required for customer-facing answers</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name="human_handoff_enabled"
              defaultChecked={defaults.human_handoff_enabled}
              className="rounded border-input"
            />
            <span>Human handoff enabled</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name="agent_assist_enabled"
              defaultChecked={defaults.agent_assist_enabled}
              className="rounded border-input"
            />
            <span>Agent assist mode enabled</span>
          </label>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Knowledge orchestration</CardTitle>
          <CardDescription>
            Assign whole knowledge bases (recommended) and/or individual articles. Voice and chat retrieval use the
            union of selected bases plus direct article links. If nothing is selected here, the agent can use the full
            tenant corpus (legacy default).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="knowledge_base_ids">
              Knowledge bases
            </label>
            <select
              id="knowledge_base_ids"
              name="knowledge_base_ids"
              multiple
              className={multiCls}
              defaultValue={defaults.selectedKnowledgeBaseIds}
            >
              {knowledgeBases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Create bases under{" "}
              <Link href="/knowledge/bases" className="text-primary underline">
                Knowledge → Bases
              </Link>
              . Hold Ctrl / Cmd to select multiple.
            </p>
          </div>
          <label className="text-sm font-medium" htmlFor="article_ids">
            Allowed knowledge articles (optional)
          </label>
          <select
            id="article_ids"
            name="article_ids"
            multiple
            className={multiCls}
            defaultValue={defaults.selectedArticleIds}
          >
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Hold Ctrl / Cmd to select multiple.</p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Workflow automation</CardTitle>
          <CardDescription>Default workflow and broader allowlist for orchestration from conversations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="workflow_id">
              Default workflow (optional)
            </label>
            <select id="workflow_id" name="workflow_id" className={selectCls} defaultValue={defaults.workflow_id}>
              <option value="">— None —</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <Separator />
          <div>
            <label className="text-sm font-medium" htmlFor="workflow_ids">
              Allowed workflows (allowlist)
            </label>
            <select
              id="workflow_ids"
              name="workflow_ids"
              multiple
              className={multiCls}
              defaultValue={defaults.selectedWorkflowIds}
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Hold Ctrl / Cmd to select multiple.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
