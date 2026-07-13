import { pool } from '../lib/db';
import { logger } from '../lib/logger';

// Guard produksi (B5): script ini MENGHAPUS SELURUH data. Tolak di produksi
// kecuali operator secara eksplisit menyatakan paham risikonya.
const RESET_ALLOWED =
  process.argv.includes('--i-understand-this-wipes-data') ||
  process.env.ALLOW_DESTRUCTIVE_DB_SCRIPT === 'yes';
if (process.env.NODE_ENV === 'production' && !RESET_ALLOWED) {
  logger.error('[db:reset] Ditolak berjalan saat NODE_ENV=production tanpa konfirmasi eksplisit');
  console.error(
    '❌ db:reset menolak berjalan saat NODE_ENV=production karena menghapus SEMUA data.\n' +
    '   Jika benar-benar disengaja, jalankan ulang dengan flag --i-understand-this-wipes-data.'
  );
  process.exit(1);
}

async function reset() {
  console.log('⚠️  Menghapus semua data dari database (TRUNCATE, FK checks off)...\n');

  const conn = await pool.getConnection();
  try {
    // Ambil daftar semua tabel di database aktif.
    const [rows]: any = await conn.query(
      `SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
    );
    const tables: string[] = rows
      .map((r: any) => r.t as string)
      // Jaga tabel bookkeeping migrasi agar riwayat migrasi tidak hilang.
      .filter((t: string) => t !== '_migrations');

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await conn.query(`TRUNCATE TABLE \`${table}\``);
      console.log(`  ✅ ${table}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }

  console.log('\n🗑️  Selesai. Database bersih dari data.');
  console.log('Jalankan: bun run db:migrate && bun run db:seed:starter\n');
  await pool.end();
}

reset().catch(async (err) => {
  logger.error({ err }, '[db:reset] Reset gagal');
  console.error('❌ Reset gagal:', err.message || err);
  await pool.end().catch(() => {});
  process.exit(1);
});
