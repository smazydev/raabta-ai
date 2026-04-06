import { getOpenAI } from "@/lib/ai/openai";

const DEFAULT_MODEL = "text-embedding-3-small";

export function getEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_MODEL;
}

/** Returns 1536-dim vectors for text-embedding-3-small (default). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { vectors } = await embedTextsWithUsage(texts);
  return vectors;
}

export async function embedTextsWithUsage(texts: string[]): Promise<{
  vectors: number[][];
  usage: { prompt_tokens?: number; total_tokens?: number } | null;
}> {
  if (texts.length === 0) return { vectors: [], usage: null };
  const openai = getOpenAI();
  const model = getEmbeddingModel();
  const res = await openai.embeddings.create({
    model,
    input: texts,
  });
  const out: number[][] = [];
  for (const item of res.data.sort((a, b) => a.index - b.index)) {
    out.push(item.embedding);
  }
  const usage = res.usage
    ? { prompt_tokens: res.usage.prompt_tokens, total_tokens: res.usage.total_tokens }
    : null;
  return { vectors: out, usage };
}

export function vectorToPgLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
