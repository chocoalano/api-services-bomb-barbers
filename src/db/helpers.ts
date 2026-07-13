/**
 * Helper boundary hasil migrasi ke Drizzle ORM.
 *
 * Query layer lama mengembalikan kolom snake_case, sedangkan Drizzle
 * mengembalikan camelCase sesuai definisi schema. Response API ke aplikasi
 * mobile HARUS tetap snake_case, jadi:
 *   - `snakeKeys()` dipakai pada HASIL query Drizzle (camelCase -> snake_case)
 *   - `camelKeys()` dipakai pada PAYLOAD insert/update yang masih ditulis
 *     snake_case oleh caller (snake_case -> camelCase) sebelum ke Drizzle.
 *
 * Konversi hanya menyentuh key object biasa; Date, array primitif, dan nilai
 * skalar diteruskan apa adanya.
 */

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function isPlainObject(v: any): boolean {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function convertKeys<T = any>(value: any, fn: (k: string) => string): T {
  if (Array.isArray(value)) return value.map((v) => convertKeys(v, fn)) as any;
  if (isPlainObject(value)) {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[fn(k)] = convertKeys(v, fn);
    }
    return out;
  }
  return value;
}

/** camelCase (hasil Drizzle) -> snake_case (untuk response API). */
export function snakeKeys<T = any>(value: T): any {
  return convertKeys(value, toSnake);
}

/** snake_case (payload caller) -> camelCase (untuk .values() Drizzle). */
export function camelKeys<T = any>(value: T): any {
  return convertKeys(value, toCamel);
}

/** Ambil elemen pertama (pengganti .single()/.maybeSingle()) atau null. */
export function first<T>(rows: T[]): T | null {
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Konversi Date/ISO-string -> format DATETIME MySQL 'YYYY-MM-DD HH:MM:SS.ffffff'
 * dalam UTC. MySQL menolak string ISO ('...T...Z') saat INSERT/UPDATE (walau
 * menerimanya saat perbandingan WHERE), jadi nilai datetime eksplisit yang
 * di-insert/update wajib dilewatkan helper ini.
 */
export function toDbDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds() * 1000, 6)}`
  );
}
