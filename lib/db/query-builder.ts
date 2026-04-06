import type { Pool } from "pg";

const IDENT = /^[a-z_][a-z0-9_]*$/i;

export type DbError = { message: string; code?: string };
export type DbResult<T> = { data: T | null; error: DbError | null; count?: number | null };

function assertIdent(name: string, ctx: string) {
  if (!IDENT.test(name)) throw new Error(`Invalid identifier ${ctx}: ${name}`);
}

function quoteIdent(s: string): string {
  assertIdent(s, "ident");
  return `"${s.replace(/"/g, '""')}"`;
}

function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && !Array.isArray(v[0])) {
    return JSON.stringify(v);
  }
  return v;
}

type EqFilter = { t: "eq"; col: string; val: unknown };
type InFilter = { t: "in"; col: string; vals: unknown[] };
type GteFilter = { t: "gte"; col: string; val: unknown };
type LteFilter = { t: "lte"; col: string; val: unknown };
type LtFilter = { t: "lt"; col: string; val: unknown };
type OrIlikeFilter = { t: "or_ilike"; pairs: { col: string; val: string }[] };

type Filter = EqFilter | InFilter | GteFilter | LteFilter | LtFilter | OrIlikeFilter;

function inferConflict(table: string, row: Record<string, unknown> | undefined): string {
  if (!row) return "id";
  if (table === "settings" && row.tenant_id != null) return "tenant_id";
  if (row.id != null) return "id";
  return "id";
}

export class QueryBuilder implements PromiseLike<DbResult<unknown>> {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private cols = "*";
  private countHead = false;
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private insertRows: Record<string, unknown>[] = [];
  private updateRow: Record<string, unknown> | null = null;
  private upsertOnConflict: string | null = null;
  /** After insert/upsert: .select('id') sets RETURNING */
  private returningCols: string | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly table: string
  ) {
    assertIdent(table, "table");
  }

  select(columns = "*", opts?: { count?: "exact"; head?: boolean }) {
    if ((this.op === "insert" || this.op === "upsert") && !opts?.head) {
      this.returningCols = columns;
      return this;
    }
    this.cols = columns;
    if (opts?.count === "exact" && opts?.head) {
      this.countHead = true;
    }
    this.op = "select";
    return this;
  }

  eq(column: string, value: unknown) {
    assertIdent(column, "column");
    this.filters.push({ t: "eq", col: column, val: value });
    return this;
  }

  in(column: string, values: unknown[]) {
    assertIdent(column, "column");
    this.filters.push({ t: "in", col: column, vals: values });
    return this;
  }

  gte(column: string, value: unknown) {
    assertIdent(column, "column");
    this.filters.push({ t: "gte", col: column, val: value });
    return this;
  }

  lte(column: string, value: unknown) {
    assertIdent(column, "column");
    this.filters.push({ t: "lte", col: column, val: value });
    return this;
  }

  lt(column: string, value: unknown) {
    assertIdent(column, "column");
    this.filters.push({ t: "lt", col: column, val: value });
    return this;
  }

  or(expression: string) {
    const parts = expression.split(",").map((p) => p.trim());
    const pairs: { col: string; val: string }[] = [];
    for (const segment of parts) {
      const dot1 = segment.indexOf(".");
      const dot2 = segment.indexOf(".", dot1 + 1);
      if (dot1 < 0 || dot2 < 0) continue;
      const col = segment.slice(0, dot1);
      const op = segment.slice(dot1 + 1, dot2);
      let val = segment.slice(dot2 + 1);
      assertIdent(col, "or column");
      if (op === "ilike") {
        if (val.startsWith("%") && val.endsWith("%")) val = val.slice(1, -1);
        pairs.push({ col, val: `%${val}%` });
      } else if (op === "eq") {
        pairs.push({ col, val });
      }
    }
    if (pairs.length) this.filters.push({ t: "or_ilike", pairs });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    assertIdent(column, "column");
    this.orderCol = column;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  insert(rowOrRows: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = "insert";
    this.insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.op = "update";
    this.updateRow = patch;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  upsert(rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    this.upsertOnConflict = opts?.onConflict ?? inferConflict(this.table, this.insertRows[0]);
    return this;
  }

  async single(): Promise<DbResult<Record<string, unknown>>> {
    const r = await this.execute();
    if (r.error) return r as DbResult<Record<string, unknown>>;
    if (this.countHead) {
      return { data: null, error: { message: "single() incompatible with count head" }, count: r.count };
    }
    const rows = (r.data as Record<string, unknown>[]) ?? [];
    if (rows.length === 0) {
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    if (rows.length > 1) {
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    return { data: rows[0]!, error: null };
  }

  async maybeSingle(): Promise<DbResult<Record<string, unknown>>> {
    const r = await this.execute();
    if (r.error) return r as DbResult<Record<string, unknown>>;
    if (this.countHead) return { data: null, error: { message: "maybeSingle() incompatible with count head" } };
    const rows = (r.data as Record<string, unknown>[]) ?? [];
    if (rows.length === 0) return { data: null, error: null };
    if (rows.length > 1) {
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    return { data: rows[0]!, error: null };
  }

  then<TResult1 = DbResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private async execute(): Promise<DbResult<unknown>> {
    try {
      if (this.op === "select") return await this.runSelect();
      if (this.op === "insert") return await this.runInsert();
      if (this.op === "upsert") return await this.runUpsert();
      if (this.op === "update") return await this.runUpdate();
      if (this.op === "delete") return await this.runDelete();
      return { data: null, error: { message: "unknown op" } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? String((e as { code?: string }).code ?? "")
          : undefined;
      return { data: null, error: { message: msg, ...(code ? { code } : {}) } };
    }
  }

  private buildWhereParts(start: number): { whereParts: string; whereParams: unknown[]; next: number } {
    const params: unknown[] = [];
    let i = start;
    const parts: string[] = [];
    for (const f of this.filters) {
      if (f.t === "eq") {
        parts.push(`${quoteIdent(f.col)} = $${i}`);
        params.push(serializeValue(f.val));
        i++;
      } else if (f.t === "in") {
        const ph = f.vals.map((_, j) => `$${i + j}`).join(", ");
        f.vals.forEach((v) => params.push(serializeValue(v)));
        parts.push(`${quoteIdent(f.col)} IN (${ph})`);
        i += f.vals.length;
      } else if (f.t === "gte") {
        parts.push(`${quoteIdent(f.col)} >= $${i}`);
        params.push(serializeValue(f.val));
        i++;
      } else if (f.t === "lte") {
        parts.push(`${quoteIdent(f.col)} <= $${i}`);
        params.push(serializeValue(f.val));
        i++;
      } else if (f.t === "lt") {
        parts.push(`${quoteIdent(f.col)} < $${i}`);
        params.push(serializeValue(f.val));
        i++;
      } else if (f.t === "or_ilike") {
        const subs: string[] = [];
        for (const p of f.pairs) {
          subs.push(`${quoteIdent(p.col)} ILIKE $${i}`);
          params.push(p.val);
          i++;
        }
        parts.push(`(${subs.join(" OR ")})`);
      }
    }
    return { whereParts: parts.length ? `WHERE ${parts.join(" AND ")}` : "", whereParams: params, next: i };
  }

  private async runSelect(): Promise<DbResult<unknown>> {
    const { whereParts, whereParams } = this.buildWhereParts(1);
    let sql: string;
    const params = [...whereParams];
    if (this.countHead) {
      sql = `SELECT COUNT(*)::int AS c FROM ${quoteIdent(this.table)} ${whereParts}`;
    } else {
      const colSql =
        this.cols === "*"
          ? "*"
          : this.cols
              .split(",")
              .map((c) => c.trim())
              .map((c) => quoteIdent(c))
              .join(", ");
      sql = `SELECT ${colSql} FROM ${quoteIdent(this.table)} ${whereParts}`;
      if (this.orderCol) {
        sql += ` ORDER BY ${quoteIdent(this.orderCol)} ${this.orderAsc ? "ASC" : "DESC"}`;
      }
      if (this.limitN != null) {
        sql += ` LIMIT ${this.limitN}`;
      }
    }
    const res = await this.pool.query(sql, params);
    if (this.countHead) {
      return { data: null, error: null, count: res.rows[0]?.c ?? 0 };
    }
    return { data: res.rows, error: null };
  }

  private async runInsert(): Promise<DbResult<unknown>> {
    const rows = this.insertRows;
    if (rows.length === 0) return { data: null, error: { message: "no rows" } };
    const cols = Object.keys(rows[0]!);
    const allParams: unknown[] = [];
    const valueGroups: string[] = [];
    let p = 1;
    for (const row of rows) {
      const vals = cols.map((c) => serializeValue(row[c]));
      const placeholders = vals.map((v, idx) => {
        const col = cols[idx]!;
        if (col === "embedding" && typeof v === "string" && v.startsWith("[")) {
          return `$${p++}::vector`;
        }
        return `$${p++}`;
      });
      valueGroups.push(`(${placeholders.join(", ")})`);
      allParams.push(...vals);
    }
    let sql = `INSERT INTO ${quoteIdent(this.table)} (${cols.map(quoteIdent).join(", ")}) VALUES ${valueGroups.join(", ")}`;
    if (this.returningCols) {
      const rcols =
        this.returningCols === "*"
          ? "*"
          : this.returningCols
              .split(",")
              .map((c) => quoteIdent(c.trim()))
              .join(", ");
      sql += ` RETURNING ${rcols}`;
    }
    const res = await this.pool.query(sql, allParams);
    return { data: this.returningCols ? res.rows : null, error: null };
  }

  private async runUpsert(): Promise<DbResult<unknown>> {
    const conflict = this.upsertOnConflict ?? "id";
    for (const c of conflict.split(",")) assertIdent(c.trim(), "onConflict");
    const rows = this.insertRows;
    if (rows.length === 0) return { data: null, error: { message: "no rows" } };
    const cols = Object.keys(rows[0]!);
    const allParams: unknown[] = [];
    const valueGroups: string[] = [];
    let p = 1;
    for (const row of rows) {
      const vals = cols.map((c) => serializeValue(row[c]));
      valueGroups.push(`(${vals.map(() => `$${p++}`).join(", ")})`);
      allParams.push(...vals);
    }
    const conflictCols = conflict.split(",").map((c) => quoteIdent(c.trim()));
    const updateCols = cols.filter((c) => !conflict.split(",").map((x) => x.trim()).includes(c));
    const setClause =
      updateCols.length > 0
        ? updateCols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(", ")
        : `${quoteIdent(cols[0]!)} = EXCLUDED.${quoteIdent(cols[0]!)}`;
    let sql = `INSERT INTO ${quoteIdent(this.table)} (${cols.map(quoteIdent).join(", ")}) VALUES ${valueGroups.join(", ")} ON CONFLICT (${conflictCols.join(", ")}) DO UPDATE SET ${setClause}`;
    if (this.returningCols) {
      const rcols =
        this.returningCols === "*"
          ? "*"
          : this.returningCols
              .split(",")
              .map((c) => quoteIdent(c.trim()))
              .join(", ");
      sql += ` RETURNING ${rcols}`;
    }
    const res = await this.pool.query(sql, allParams);
    return { data: this.returningCols ? res.rows : res.rows, error: null };
  }

  private async runUpdate(): Promise<DbResult<unknown>> {
    if (!this.updateRow) return { data: null, error: { message: "no patch" } };
    const cols = Object.keys(this.updateRow);
    const { whereParts, whereParams } = this.buildWhereParts(cols.length + 1);
    const setParts = cols.map((c, idx) => `${quoteIdent(c)} = $${idx + 1}`);
    const vals = cols.map((c) => serializeValue(this.updateRow![c]));
    const sql = `UPDATE ${quoteIdent(this.table)} SET ${setParts.join(", ")} ${whereParts}`;
    await this.pool.query(sql, [...vals, ...whereParams]);
    return { data: null, error: null };
  }

  private async runDelete(): Promise<DbResult<unknown>> {
    const { whereParts, whereParams } = this.buildWhereParts(1);
    const sql = `DELETE FROM ${quoteIdent(this.table)} ${whereParts}`;
    await this.pool.query(sql, whereParams);
    return { data: null, error: null };
  }
}
