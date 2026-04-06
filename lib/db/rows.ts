/** Normalize `unknown` query `data` from the query builder into a typed array. */
export function dbRows<T extends Record<string, unknown>>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}
