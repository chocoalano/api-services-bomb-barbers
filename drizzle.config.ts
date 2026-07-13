import type { Config } from 'drizzle-kit';

// Selaras dengan resolveDatabaseConnectionString() di src/lib/db.ts: dukung
// DATABASE_URL/MYSQL_URL utuh maupun bagian terpisah DATABASE_SERVER/PORT/USER/
// PASSWORD/NAME. Diinline (bukan import) agar drizzle-kit tak memicu pembuatan pool.
function resolveDatabaseUrl(): string {
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

export default {
  schema: ['./src/db/schema.ts', './src/db/schema-extra.ts'],
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url: resolveDatabaseUrl()
  }
} satisfies Config;
