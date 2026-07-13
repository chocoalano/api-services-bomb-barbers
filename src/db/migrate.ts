import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { pool, maskDatabaseConnectionString, resolveDatabaseConnectionString } from '../lib/db';
import { logger } from '../lib/logger';

// Migrasi MySQL: terapkan file SQL hasil drizzle-kit di folder `drizzle/`.
// Tiap file dipisah menjadi statement oleh penanda `--> statement-breakpoint`.
const MIGRATIONS_DIR = join(import.meta.dir, '../../drizzle');

async function getMigrationFiles(): Promise<{ name: string; statements: string[] }[]> {
  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }

  const out: { name: string; statements: string[] }[] = [];
  for (const file of files) {
    const raw = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = raw
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({ name: file, statements });
  }
  return out;
}

async function runMigrations(): Promise<void> {
  console.log('🔄 Menjalankan migrasi MySQL...\n');
  const connString = resolveDatabaseConnectionString();
  if (connString) console.log(`📦 Database: ${maskDatabaseConnectionString(connString)}\n`);

  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      )
    `);

    const [appliedRows]: any = await conn.query('SELECT name FROM _migrations');
    const applied = new Set<string>(appliedRows.map((r: any) => r.name));

    const migrations = await getMigrationFiles();
    console.log(`📋 Ditemukan ${migrations.length} file migrasi\n`);

    let count = 0;
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        console.log(`⏭️  Sudah diterapkan: ${migration.name}`);
        continue;
      }
      console.log(`⏳ Menerapkan: ${migration.name}`);
      await conn.query('START TRANSACTION');
      try {
        for (const stmt of migration.statements) {
          await conn.query(stmt);
        }
        await conn.query('INSERT INTO _migrations (name) VALUES (?)', [migration.name]);
        await conn.query('COMMIT');
      } catch (error: any) {
        await conn.query('ROLLBACK').catch(() => {});
        logger.error({ err: error, migration: migration.name }, '[db:migrate] Gagal menerapkan migrasi');
        console.error(`❌ Gagal menerapkan ${migration.name}: ${error?.message}`);
        throw error;
      }
      console.log(`✅ Diterapkan: ${migration.name}\n`);
      count++;
    }

    console.log(`\n🎉 Migrasi selesai! ${count} migrasi baru diterapkan.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

runMigrations().catch(async (error: any) => {
  logger.error({ err: error }, '[db:migrate] Migrasi gagal');
  console.error('❌ Migrasi gagal:', error?.message || error);
  await pool.end().catch(() => {});
  process.exit(1);
});
