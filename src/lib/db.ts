import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as baseSchema from '../db/schema';
import * as extraSchema from '../db/schema-extra';

const schema = { ...baseSchema, ...extraSchema };

/**
 * Susun connection string MySQL dari env. Prioritas:
 *  1. DATABASE_URL / MYSQL_URL (URL mysql:// utuh) bila di-set.
 *  2. Bagian terpisah DATABASE_SERVER/PORT/USER/PASSWORD/NAME.
 *  3. Default lokal untuk dev.
 * Kredensial di-URL-encode agar password berisi karakter khusus (mis. '@', ':')
 * tetap aman. Password kosong (root tanpa password) didukung.
 */
export function resolveDatabaseConnectionString(): string {
  const explicit = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (explicit) return explicit;

  const host = process.env.DATABASE_SERVER;
  const name = process.env.DATABASE_NAME;
  if (host && name) {
    const port = process.env.DATABASE_PORT || '3306';
    const user = encodeURIComponent(process.env.DATABASE_USER || 'root');
    const password = encodeURIComponent(process.env.DATABASE_PASSWORD ?? '');
    return `mysql://${user}:${password}@${host}:${port}/${name}`;
  }

  return 'mysql://root:root@localhost:3306/bomb_barbers';
}

const connectionString = resolveDatabaseConnectionString();

// Satu pool untuk seluruh proses. `timezone: 'Z'` memastikan kolom DATETIME
// dibaca/ditulis sebagai UTC (sepadan dengan perilaku timestamptz lama).
export const pool = mysql.createPool({
  uri: connectionString,
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  namedPlaceholders: true
});

export const db = drizzle(pool, { schema, mode: 'default' });

export type Database = typeof db;
export { schema };

export const maskDatabaseConnectionString = (value: string) => {
  try {
    const url = new URL(value);
    const username = decodeURIComponent(url.username);
    return `${url.protocol}//${username}:****@${url.host}${url.pathname}`;
  } catch {
    return '[invalid database connection string]';
  }
};
