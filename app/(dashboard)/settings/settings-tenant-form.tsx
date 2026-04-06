"use client";

import { updateSettingsAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type SettingsTenantFormProps = {
  isAdmin: boolean;
  appName: string;
  escalationThreshold: number;
  romanUrduSupport: boolean;
  aiAutoReply: boolean;
  aiSummaries: boolean;
  aiAssistantCopilot: boolean;
  aiEmbeddings: boolean;
  aiTts: boolean;
  twilioInbound: string;
  twilioEscalation: string;
  providerProfile: Record<string, string>;
  liveWebhookSecretStored: boolean;
};

export function SettingsTenantForm(props: SettingsTenantFormProps) {
  const {
    isAdmin,
    appName,
    escalationThreshold,
    romanUrduSupport,
    aiAutoReply,
    aiSummaries,
    aiAssistantCopilot,
    aiEmbeddings,
    aiTts,
    twilioInbound,
    twilioEscalation,
    providerProfile: pp,
    liveWebhookSecretStored,
  } = props;

  return (
    <form action={updateSettingsAction} className="space-y-4">
      <Tabs defaultValue="general" className="gap-4">
        <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="provider">Provider</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 pt-2" keepMounted>
          <div>
            <label className="text-sm font-medium" htmlFor="app_name">
              App name
            </label>
            <Input id="app_name" name="app_name" defaultValue={appName} disabled={!isAdmin} />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="escalation_threshold">
              Escalation threshold (attempts)
            </label>
            <Input
              id="escalation_threshold"
              name="escalation_threshold"
              type="number"
              min={1}
              max={10}
              defaultValue={escalationThreshold}
              disabled={!isAdmin}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="roman_urdu" defaultChecked={romanUrduSupport} disabled={!isAdmin} />
            Roman Urdu support in AI replies (when reply language is Urdu)
          </label>
        </TabsContent>

        <TabsContent value="ai" className="space-y-3 pt-2" keepMounted>
          <p className="text-xs text-muted-foreground">
            Per-tenant kill switches for compliance drills or rollout. Covers dashboard flows,{" "}
            <code className="rounded bg-secondary px-1">/api/ai/*</code>, assistant chat, embeddings index/search, and
            TTS.
          </p>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="ai_auto_reply" defaultChecked={aiAutoReply} disabled={!isAdmin} />
              AI replies &amp; intent classification (conversations, demo, overview widget, API classify/reply)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="ai_summaries" defaultChecked={aiSummaries} disabled={!isAdmin} />
              AI summaries &amp; suggested replies (assist pack, conversation summary, API summary/suggest-reply)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="ai_assistant_copilot" defaultChecked={aiAssistantCopilot} disabled={!isAdmin} />
              AI copilot (<code className="rounded bg-secondary px-1 text-[11px]">/assistant</code> + tools +{" "}
              <code className="rounded bg-secondary px-1 text-[11px]">/api/assistant/chat</code>)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="ai_embeddings" defaultChecked={aiEmbeddings} disabled={!isAdmin} />
              Knowledge embeddings (semantic RAG + rebuild index; ILIKE search still works when off)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="ai_tts" defaultChecked={aiTts} disabled={!isAdmin} />
              Text-to-speech (<code className="rounded bg-secondary px-1 text-[11px]">/api/ai/tts</code>)
            </label>
          </div>
        </TabsContent>

        <TabsContent value="provider" className="space-y-3 pt-2" keepMounted>
          <p className="text-xs text-muted-foreground">
            Inbound PSTN mapping and provider record. Server env:{" "}
            <code className="rounded bg-secondary px-1">TWILIO_AUTH_TOKEN</code> for signed webhooks. When set,
            server-side OpenAI calls use the model below; otherwise{" "}
            <code className="rounded bg-secondary px-1">OPENAI_MODEL</code> or{" "}
            <code className="rounded bg-secondary px-1">gpt-4o-mini</code>.
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="twilio_inbound_e164">
              Twilio inbound number (E.164, must match Voice &quot;To&quot;)
            </label>
            <p className="mb-1 text-[11px] text-muted-foreground">
              Set the number&apos;s Voice webhook to <code className="rounded bg-secondary px-1">POST</code>{" "}
              <code className="rounded bg-secondary px-1">…/api/webhooks/twilio/voice</code> on this app.
            </p>
            <Input
              id="twilio_inbound_e164"
              name="twilio_inbound_e164"
              defaultValue={twilioInbound}
              placeholder="+15551234567"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="twilio_escalation_e164">
              Human escalation number (E.164, optional)
            </label>
            <p className="mb-1 text-[11px] text-muted-foreground">
              When the line escalates, Twilio can <code className="rounded bg-secondary px-1">Dial</code> this number.
              Leave blank to play the message and hang up.
            </p>
            <Input
              id="twilio_escalation_e164"
              name="twilio_escalation_e164"
              defaultValue={twilioEscalation}
              placeholder="+15559876543"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pp_model">
              Preferred OpenAI model (record)
            </label>
            <Input
              id="pp_model"
              name="pp_model"
              defaultValue={pp.default_openai_model ?? ""}
              placeholder="e.g. gpt-4o-mini"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pp_region">
              Deployment region
            </label>
            <Input
              id="pp_region"
              name="pp_region"
              defaultValue={pp.deployment_region ?? ""}
              placeholder="e.g. EU-West / PK-GCP"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pp_residency">
              Data residency note
            </label>
            <Input
              id="pp_residency"
              name="pp_residency"
              defaultValue={pp.data_residency_note ?? ""}
              placeholder="Where PII and logs are expected to stay"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pp_live_webhook">
              Live events webhook URL (optional)
            </label>
            <p className="mb-1 text-[11px] text-muted-foreground">
              POST JSON for each <code className="rounded bg-secondary px-1">live_events</code> row (workflows,
              conversations, API ingest). Separate from the audit webhook below.
            </p>
            <Input
              id="pp_live_webhook"
              name="pp_live_webhook"
              type="url"
              defaultValue={pp.live_events_webhook_url ?? ""}
              placeholder="https://your-siem.example/hooks/raabta-live"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pp_live_webhook_secret">
              Live events signing secret (optional)
            </label>
            <p className="mb-1 text-[11px] text-muted-foreground">
              When set, requests include{" "}
              <code className="rounded bg-secondary px-1">X-Raabta-Signature: v1=&lt;hex&gt;</code> — HMAC-SHA256 of
              the raw JSON body. Leave blank to keep the current secret.
            </p>
            {liveWebhookSecretStored ? (
              <p className="mb-1 text-[11px] font-medium text-primary">A signing secret is already stored.</p>
            ) : null}
            <Input
              id="pp_live_webhook_secret"
              name="pp_live_webhook_secret"
              type="password"
              autoComplete="new-password"
              placeholder={liveWebhookSecretStored ? "•••••••• (enter new to replace)" : "e.g. rotate from your SIEM"}
              disabled={!isAdmin}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="pp_live_webhook_secret_clear" disabled={!isAdmin} />
              Remove signing secret
            </label>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pp_webhook">
              Audit / usage webhook URL (optional)
            </label>
            <Input
              id="pp_webhook"
              name="pp_webhook"
              type="url"
              defaultValue={pp.audit_export_webhook_url ?? ""}
              placeholder="https://…"
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="pp_runbook">
              SLA / runbook URL
            </label>
            <Input
              id="pp_runbook"
              name="pp_runbook"
              type="url"
              defaultValue={pp.sla_runbook_url ?? ""}
              placeholder="Link to what you operate vs customer-operated"
              disabled={!isAdmin}
            />
          </div>
        </TabsContent>
      </Tabs>

      {isAdmin ? <Button type="submit">Save</Button> : <p className="text-xs text-muted-foreground">Ask an admin to change settings.</p>}
    </form>
  );
}
