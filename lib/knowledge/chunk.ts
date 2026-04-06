/** Simple character-window chunking for embeddings (no sentence NLP). */
export function chunkText(text: string, maxChars = 1400, overlap = 200): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];

  const chunks: string[] = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + maxChars, t.length);
    let slice = t.slice(start, end);
    if (end < t.length) {
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (lastBreak > maxChars * 0.4) {
        slice = slice.slice(0, lastBreak + 1).trim();
      }
    }
    if (slice.length > 0) chunks.push(slice);
    const next = start + slice.length - overlap;
    start = next <= start ? end : next;
  }
  return chunks;
}
