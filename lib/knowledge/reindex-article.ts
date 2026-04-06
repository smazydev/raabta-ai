import type { AppDbClient } from "@/lib/db/types";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { chunkText } from "./chunk";
import { embedTextsWithUsage, vectorToPgLiteral } from "./embeddings";
import { chargeAfterEmbeddingCall } from "@/lib/billing/credits";

/**
 * Replaces all embedding chunks for a knowledge article. Call after insert/update.
 */
export async function reindexKnowledgeArticle(
  supabase: AppDbClient,
  tenantId: string,
  articleId: string,
  title: string,
  body: string
): Promise<void> {
  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.embeddingsEnabled) {
    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("source_kind", "article")
      .eq("source_id", articleId);
    return;
  }

  const full = `${title}\n\n${body}`;
  const parts = chunkText(full);

  if (parts.length === 0) {
    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("source_kind", "article")
      .eq("source_id", articleId);
    return;
  }

  const { vectors: embeddings, usage } = await embedTextsWithUsage(parts);
  await chargeAfterEmbeddingCall(tenantId, usage, "openai.embeddings.reindex", {
    article_id: articleId,
    chunk_count: parts.length,
  });

  await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("source_kind", "article")
    .eq("source_id", articleId);

  const inserts = parts.map((content, i) => ({
    tenant_id: tenantId,
    source_kind: "article" as const,
    source_id: articleId,
    chunk_index: i,
    content,
    embedding: vectorToPgLiteral(embeddings[i]!),
  }));

  const { error } = await supabase.from("knowledge_chunks").insert(inserts);
  if (error) throw new Error(error.message);
}
