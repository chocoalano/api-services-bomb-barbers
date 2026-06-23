import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dir, '../../supabase/migrations');
const OUTPUT_FILE = join(import.meta.dir, '../../MIGRATIONS_TO_APPLY.sql');

async function generateMigrationSQL(): Promise<void> {
  console.log('🔄 Generating combined migration SQL...\n');

  try {
    const files = await readdir(MIGRATIONS_DIR);
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

    if (sqlFiles.length === 0) {
      console.log('✅ No migrations to generate');
      return;
    }

    let combinedSQL = `-- Combined Migrations for Bomb Barbershop API
-- Generated: ${new Date().toISOString()}
-- 
-- Instructions:
-- 1. Go to: https://app.supabase.com/project/fbvdazkwvueewghjysqa/sql/new
-- 2. Copy paste this entire SQL below the comment markers
-- 3. Click "Run" button
-- 4. Wait for success message
--
-- ============================================
-- START PASTE FROM HERE:
-- ============================================\n\n`;

    for (const file of sqlFiles) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
      combinedSQL += `-- Migration: ${file}\n`;
      combinedSQL += `-- ----------------------------------------\n`;
      combinedSQL += sql.trim() + '\n\n';
    }

    combinedSQL += `-- ============================================
-- END PASTE HERE
-- ============================================\n`;

    await writeFile(OUTPUT_FILE, combinedSQL);

    console.log(`✅ Generated: ${OUTPUT_FILE}`);
    console.log(`📊 Total migrations: ${sqlFiles.length}`);
    console.log('\n📋 Migration files included:');
    sqlFiles.forEach((f) => console.log(`   - ${f}`));
    console.log('\n📖 Next steps:');
    console.log('   1. Open MIGRATIONS_TO_APPLY.sql file');
    console.log('   2. Copy the SQL between the markers');
    console.log('   3. Paste in Supabase SQL Editor: https://app.supabase.com/project/fbvdazkwvueewghjysqa/sql/new');
    console.log('   4. Click "Run"');
  } catch (error: any) {
    console.error('❌ Failed:', error.message || error);
    process.exit(1);
  }
}

generateMigrationSQL();
