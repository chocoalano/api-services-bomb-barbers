import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import postgres from 'postgres';
import {
  maskDatabaseConnectionString,
  resolveDatabaseConnection
} from './connection';
import { isMigrationRepresented } from './migration-baseline';

const MIGRATIONS_DIR = join(import.meta.dir, '../../supabase/migrations');

interface Migration {
  name: string;
  sql: string;
}

async function getMigrations(): Promise<Migration[]> {
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  const migrations: Migration[] = [];
  for (const file of sqlFiles) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    migrations.push({ name: file, sql });
  }

  return migrations;
}

async function runMigrations(): Promise<void> {
  console.log('🔄 Starting database migrations...\n');

  try {
    const resolvedConnection = await resolveDatabaseConnection();
    const connectionString = resolvedConnection.connectionString;

    console.log(
      `📦 Connecting to database: ${maskDatabaseConnectionString(connectionString)}`
    );
    if (resolvedConnection.source === 'linked-project-pooler') {
      console.log(
        'ℹ️  Direct host Supabase diganti otomatis dengan Session Pooler dari project yang terhubung (IPv4 compatible).\n'
      );
    } else {
      console.log('');
    }

    const sql = postgres(connectionString, {
      // Supabase transaction pooler tidak mendukung prepared statements.
      // Opsi ini juga aman untuk direct/session connection.
      prepare: false
    });

    try {
      // Ensure migrations table exists
      await sql`
        CREATE TABLE IF NOT EXISTS _migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      const migrations = await getMigrations();
      console.log(`📋 Found ${migrations.length} migration files\n`);

      if (migrations.length === 0) {
        console.log('✅ No migrations to run');
        return;
      }

      // Get applied migrations
      const applied = await sql<{ name: string }[]>`
        SELECT name FROM _migrations ORDER BY executed_at ASC;
      `;

      const appliedNames = new Set(applied.map((row) => row.name));
      console.log(`✅ Previously applied: ${applied.length || 'none'}\n`);

      let appliedCount = 0;
      let baselinedCount = 0;
      for (const migration of migrations) {
        if (appliedNames.has(migration.name)) {
          console.log(`⏭️  Skipped (already applied): ${migration.name}`);
          continue;
        }

        if (await isMigrationRepresented(sql, migration.name)) {
          await sql`
            INSERT INTO _migrations (name)
            VALUES (${migration.name})
            ON CONFLICT (name) DO NOTHING
          `;
          appliedNames.add(migration.name);
          baselinedCount++;
          console.log(`🧭 Baselined (schema already present): ${migration.name}`);
          continue;
        }

        console.log(`⏳ Running: ${migration.name}`);

        try {
          await sql.begin(async (transaction) => {
            await transaction.unsafe(migration.sql);
            await transaction`
              INSERT INTO _migrations (name) VALUES (${migration.name})
            `;
          });
        } catch (error: any) {
          console.error(`❌ Failed to apply ${migration.name}:`);
          console.error(error.message || error);
          throw error;
        }

        console.log(`✅ Applied: ${migration.name}\n`);
        appliedCount++;
      }

      console.log(
        `\n🎉 Migration complete! Applied ${appliedCount} new migration(s), baselined ${baselinedCount} existing migration(s)`
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (error: any) {
    if (error?.code === 'ENOTFOUND' || String(error?.message || '').includes('ENOTFOUND')) {
      console.error('❌ Host database tidak bisa di-resolve.');
      console.error('   Set DATABASE_URL dari Supabase Database Connection String (Pooler), lalu jalankan ulang:');
      console.error("   DATABASE_URL='postgresql://...' bun run db:migrate");
      console.error('');
    }
    console.error('❌ Migration failed:', error.message || error);
    process.exit(1);
  }
}

runMigrations();
