import Link from "next/link";
import { getSessionTenant } from "@/lib/session";
import { getDashboardAiStripData } from "@/lib/ai/dashboard-ai-strip-data";
import { cn } from "@/lib/utils";

/** Global AI operational context for the signed-in tenant (server-rendered). */
export async function DashboardAiStrip() {
  const session = await getSessionTenant();
  if (!session) return null;
  const d = await getDashboardAiStripData(session.supabase, session.tenantId);

  if (!d.openAiConfigured) {
    return (
      <div className="border-b border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-center text-xs leading-relaxed text-amber-950 dark:text-amber-100 md:px-8">
        <strong className="font-semibold">OpenAI is not configured</strong> — set{" "}
        <code className="rounded bg-background/60 px-1 font-mono text-[10px]">OPENAI_API_KEY</code> on the server.
        Chat, summaries, embeddings, and TTS will fail until then.
      </div>
    );
  }

  const partialOff =
    !d.autoReply ||
    !d.summaries ||
    !d.assistantCopilot ||
    !d.voiceFrontdeskAi ||
    !d.embeddingsEnabled ||
    !d.ttsEnabled;

  const chip = (on: boolean, label: string) => (
    <span className={on ? "text-muted-foreground" : "font-medium text-amber-800 dark:text-amber-200"}>
      {label} {on ? "on" : "off"}
    </span>
  );

  return (
    <div
      className={cn(
        "border-b px-4 py-2 text-xs leading-relaxed md:px-8",
        partialOff ? "border-amber-500/25 bg-amber-500/5" : "border-border bg-secondary/25"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted-foreground">Chat model</span>
        <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          {d.defaultChatModel}
        </code>
        <span className="text-muted-foreground">·</span>
        {chip(d.autoReply, "Replies")}
        <span className="text-muted-foreground">·</span>
        {chip(d.summaries, "Summaries")}
        <span className="text-muted-foreground">·</span>
        {chip(d.assistantCopilot, "Copilot")}
        <span className="text-muted-foreground">·</span>
        {chip(d.voiceFrontdeskAi, "Voice desk")}
        <span className="text-muted-foreground">·</span>
        {chip(d.embeddingsEnabled, "Embeddings")}
        <span className="text-muted-foreground">·</span>
        {chip(d.ttsEnabled, "TTS")}
        {partialOff ? (
          <>
            <span className="text-muted-foreground">·</span>
            <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
              Settings
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
