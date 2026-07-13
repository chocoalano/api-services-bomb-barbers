/**
 * TEST-ONLY query helper (mysql2) — BUKAN untuk kode aplikasi.
 *
 * Aplikasi 100% memakai Drizzle (`src/lib/db.ts`). File ini hanya menyediakan
 * subset API query-builder generik DI ATAS mysql2 agar suite test lama
 * (`tests/*.test.ts`) tetap berjalan tanpa harus ditulis ulang satu per satu.
 * Tidak ada ketergantungan eksternal apa pun.
 *
 * mysql2 mengembalikan nama kolom snake_case apa adanya. Embedded-join
 * (`table(col)`, `!inner`) TIDAK didukung penuh dan hanya di-strip.
 */
import { randomUUID } from 'crypto';
import { pool } from './db';
import { asRpcResult } from '../db/procedures';
import { createAppointmentAtomic } from '../db/appointment-procedures';

type Row = Record<string, any>;
type Filter = { col: string; op: string; val: any };

// Konversi string ISO (…T…Z) → format DATETIME MySQL saat insert/update.
function toSqlVal(v: any): any {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const p = (n: number, w = 2) => String(n).padStart(w, '0');
      return (
        `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
        `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds() * 1000, 6)}`
      );
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
    return JSON.stringify(v); // kolom JSON
  }
  return v;
}

// Ambil daftar kolom top-level dari string select; buang bagian embed `x(...)`.
function parseColumns(sel: string): string {
  if (!sel || sel.trim() === '*') return '*';
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    if (depth === 0) cur += ch;
  }
  parts.push(cur);
  const cols = parts
    .map((p) => p.split('!')[0].trim())
    .filter((p) => p && !p.includes('('));
  return cols.length ? cols.map((c) => `\`${c}\``).join(', ') : '*';
}

class QueryBuilder implements PromiseLike<{ data: any; error: any; count?: number }> {
  private table: string;
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private cols = '*';
  private values: Row[] = [];
  private setData: Row = {};
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private offsetN = 0;
  private wantSingle = false;
  private wantMaybe = false;
  private wantSelectBack = false;
  private countExact = false;
  private headOnly = false;

  constructor(table: string) {
    this.table = table;
  }

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') this.cols = parseColumns(cols || '*');
    else this.wantSelectBack = true;
    if (opts?.count) this.countExact = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = 'insert';
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }
  update(data: Row) {
    this.op = 'update';
    this.setData = data;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  match(obj: Row) { for (const [col, val] of Object.entries(obj)) this.filters.push({ col, op: val === null ? 'isnull' : '=', val }); return this; }
  eq(col: string, val: any) { this.filters.push({ col, op: '=', val }); return this; }
  neq(col: string, val: any) { this.filters.push({ col, op: '<>', val }); return this; }
  gt(col: string, val: any) { this.filters.push({ col, op: '>', val }); return this; }
  gte(col: string, val: any) { this.filters.push({ col, op: '>=', val }); return this; }
  lt(col: string, val: any) { this.filters.push({ col, op: '<', val }); return this; }
  lte(col: string, val: any) { this.filters.push({ col, op: '<=', val }); return this; }
  in(col: string, vals: any[]) { this.filters.push({ col, op: 'in', val: vals }); return this; }
  is(col: string, val: any) { this.filters.push({ col, op: val === null ? 'isnull' : '=', val }); return this; }
  not(col: string, op: string, val: any) {
    if (op === 'is' && val === null) this.filters.push({ col, op: 'isnotnull', val: null });
    else if (op === 'in') this.filters.push({ col, op: 'notin', val });
    else this.filters.push({ col, op: '<>', val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.offsetN = from; this.limitN = to - from + 1; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantMaybe = true; return this; }

  private whereSql(): { sql: string; params: any[] } {
    if (!this.filters.length) return { sql: '', params: [] };
    const parts: string[] = [];
    const params: any[] = [];
    for (const f of this.filters) {
      if (f.op === 'isnull') parts.push(`\`${f.col}\` IS NULL`);
      else if (f.op === 'isnotnull') parts.push(`\`${f.col}\` IS NOT NULL`);
      else if (f.op === 'in') {
        const arr = (f.val as any[]).length ? f.val : [null];
        parts.push(`\`${f.col}\` IN (${arr.map(() => '?').join(', ')})`);
        params.push(...arr);
      } else if (f.op === 'notin') {
        const arr = (f.val as any[]).length ? f.val : [null];
        parts.push(`\`${f.col}\` NOT IN (${arr.map(() => '?').join(', ')})`);
        params.push(...arr);
      } else {
        parts.push(`\`${f.col}\` ${f.op} ?`);
        params.push(toSqlVal(f.val));
      }
    }
    return { sql: ' WHERE ' + parts.join(' AND '), params };
  }

  private async exec(): Promise<{ data: any; error: any; count?: number }> {
    try {
      const where = this.whereSql();

      if (this.op === 'insert') {
        const ids: string[] = [];
        for (const raw of this.values) {
          const row: Row = { ...raw };
          if (row.id == null) row.id = randomUUID();
          ids.push(row.id);
          const keys = Object.keys(row);
          const placeholders = keys.map(() => '?').join(', ');
          const vals = keys.map((k) => toSqlVal(row[k]));
          await pool.query(
            `INSERT INTO \`${this.table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${placeholders})`,
            vals
          );
        }
        if (this.wantSelectBack || this.wantSingle || this.wantMaybe) {
          const [rows]: any = await pool.query(
            `SELECT * FROM \`${this.table}\` WHERE id IN (${ids.map(() => '?').join(', ')})`,
            ids
          );
          return this.shape(rows);
        }
        return { data: null, error: null };
      }

      if (this.op === 'update') {
        const keys = Object.keys(this.setData);
        const setSql = keys.map((k) => `\`${k}\` = ?`).join(', ');
        const setParams = keys.map((k) => toSqlVal(this.setData[k]));
        await pool.query(`UPDATE \`${this.table}\` SET ${setSql}${where.sql}`, [...setParams, ...where.params]);
        if (this.wantSelectBack || this.wantSingle || this.wantMaybe) {
          const [rows]: any = await pool.query(`SELECT * FROM \`${this.table}\`${where.sql}`, where.params);
          return this.shape(rows);
        }
        return { data: null, error: null };
      }

      if (this.op === 'delete') {
        await pool.query(`DELETE FROM \`${this.table}\`${where.sql}`, where.params);
        return { data: null, error: null };
      }

      // SELECT
      if (this.countExact && this.headOnly) {
        const [rows]: any = await pool.query(`SELECT COUNT(*) AS c FROM \`${this.table}\`${where.sql}`, where.params);
        return { data: null, error: null, count: Number(rows[0].c) };
      }
      let sql = `SELECT ${this.cols} FROM \`${this.table}\`${where.sql}`;
      if (this.orderBy) sql += ` ORDER BY \`${this.orderBy.col}\` ${this.orderBy.asc ? 'ASC' : 'DESC'}`;
      if (this.limitN != null) sql += ` LIMIT ${this.limitN} OFFSET ${this.offsetN}`;
      const [rows]: any = await pool.query(sql, where.params);
      let count: number | undefined;
      if (this.countExact) {
        const [c]: any = await pool.query(`SELECT COUNT(*) AS c FROM \`${this.table}\`${where.sql}`, where.params);
        count = Number(c[0].c);
      }
      return { ...this.shape(rows), count };
    } catch (error: any) {
      return { data: null, error: { message: error?.message, code: error?.code } };
    }
  }

  private shape(rows: Row[]): { data: any; error: any } {
    if (this.wantSingle) {
      if (!rows.length) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      return { data: rows[0], error: null };
    }
    if (this.wantMaybe) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  then<T1 = any, T2 = never>(
    onfulfilled?: ((v: { data: any; error: any; count?: number }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export const testDb = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  async rpc(name: string, params: Row) {
    // Hanya RPC yang dipakai test yang di-route ke procedure Drizzle.
    if (name === 'create_appointment_atomic') {
      return asRpcResult(() =>
        createAppointmentAtomic({
          branchId: params.p_branch_id,
          barberId: params.p_barber_id ?? null,
          customerId: params.p_customer_id ?? null,
          serviceIds: params.p_service_ids,
          scheduledAt: params.p_scheduled_at,
          source: params.p_source,
          idempotencyKey: params.p_idempotency_key,
          actorType: params.p_actor_type,
          actorId: params.p_actor_id,
          customerMediaUrls: params.p_customer_media_urls ?? [],
          fulfillmentType: params.p_fulfillment_type ?? 'in_store',
          serviceAddress: params.p_service_address ?? null,
          destinationLatitude: params.p_destination_latitude ?? null,
          destinationLongitude: params.p_destination_longitude ?? null,
          locationNotes: params.p_location_notes ?? null,
          travelBufferMin: params.p_travel_buffer_min ?? 15
        })
      );
    }
    return { data: null, error: { message: `RPC ${name} tidak didukung shim test`, code: 'UNSUPPORTED' } };
  },
  // storage tidak dipakai test; stub agar import tidak error.
  storage: {
    from() {
      throw new Error('storage tidak tersedia di test-db — gunakan LocalStorage');
    }
  }
};
