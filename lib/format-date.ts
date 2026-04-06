/** Supabase may return `timestamptz` as ISO string or as `Date` depending on client/version. */
export function formatYmd(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "—" : value.toISOString().slice(0, 10);
  }
  return "—";
}

/** `YYYY-MM-DD HH:mm` in UTC (same as trimming ISO to 16 chars and replacing `T`). */
export function formatYmdHm(value: unknown): string {
  if (value == null) return "—";
  let s: string;
  if (typeof value === "string") {
    if (!value.trim()) return "—";
    s = value;
  } else if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "—";
    s = value.toISOString();
  } else {
    return "—";
  }
  if (s.length < 16) return s;
  return s.slice(0, 16).replace("T", " ");
}
