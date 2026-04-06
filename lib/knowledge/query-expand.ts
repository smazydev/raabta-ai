/**
 * Improves retrieval when staff write in Roman Urdu / code-mixed text while KB is English.
 */

const ROMAN_URDU_STOP = new Set([
  "hello",
  "hi",
  "the",
  "and",
  "for",
  "are",
  "you",
  "mujhe",
  "mera",
  "meri",
  "meray",
  "kya",
  "kyun",
  "kyunke",
  "ke",
  "ki",
  "ka",
  "ko",
  "se",
  "par",
  "hai",
  "hain",
  "ho",
  "hum",
  "aap",
  "main",
  "mein",
  "batao",
  "bataye",
  "bataden",
  "bataen",
  "bataiye",
  "please",
  "thanks",
  "thank",
  "bare",
  "baare",
  "mutaliq",
  "maloom",
  "kuch",
  "yeh",
  "woh",
  "agar",
  "toh",
  "bhi",
]);

/** English HR terms appended to embedding text when query looks leave/HR-related. */
const HR_LEAVE_HINT_EN =
  "employee leave annual leave sick leave casual leave vacation absence time off encashment carry forward holiday HR policy payroll";

/**
 * Broaden embedding input so vector search can match English policy chunks.
 */
export function enrichKnowledgeEmbeddingQuery(userQuery: string): string {
  const q = userQuery.trim();
  if (!q) return q;
  const lower = q.toLowerCase();
  const looksLeaveOrHr =
    /\b(leaves?|leave|chutti|chhootti|chhutti|off\s*day|vacation|holiday|sick|casual|annual|rakh|encash|policy|payroll|employee|hr)\b/i.test(
      lower
    );
  if (looksLeaveOrHr) {
    return `${q}\n${HR_LEAVE_HINT_EN}`;
  }
  const latinLong = (q.match(/\b[a-zA-Z]{4,}\b/g) ?? []).filter((w) => !ROMAN_URDU_STOP.has(w.toLowerCase()));
  if (latinLong.length > 0) {
    return `${q}\n${[...new Set(latinLong.map((w) => w.toLowerCase()))].join(" ")}`;
  }
  return q;
}

function normalizeToken(t: string): string[] {
  const lower = t.toLowerCase();
  const out = [lower];
  if (lower === "leaves") out.push("leave");
  if (lower === "policies") out.push("policy");
  if (lower === "employees") out.push("employee");
  return [...new Set(out)];
}

/**
 * Tokens for ILIKE fallback: Latin-alphabet words, minus conversational Roman Urdu.
 */
export function knowledgeTextSearchTokens(userQuery: string): string[] {
  const raw = userQuery.trim().toLowerCase();
  if (!raw) return [];
  const parts = raw.split(/[\s,.;:!?'"،۔]+/).filter((p) => p.length >= 3);
  const set = new Set<string>();
  for (const p of parts) {
    if (!/[a-z]/.test(p)) continue;
    if (ROMAN_URDU_STOP.has(p)) continue;
    if (p.length < 4 && !/^(leave|leaves|hr)$/i.test(p)) continue;
    for (const n of normalizeToken(p)) {
      if (n.length >= 3) set.add(n);
    }
  }
  return [...set].slice(0, 14);
}

export function escapeForIlikeToken(token: string): string {
  return token.replace(/\\/g, "").replace(/%/g, "").replace(/_/g, "").slice(0, 64);
}
