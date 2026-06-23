import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('❌ SUPABASE_URL dan SUPABASE_SECRET_KEY wajib diset di .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// Urutan hapus: anak dulu, parent belakangan (sesuai FK dependency graph)
const TABLE_ORDER = [
  // Leaf nodes — tidak ada tabel lain yang referensi ke sini
  'audit_logs',
  'auth_events',
  'auth_sessions',
  'media_assets',
  'notifications',
  'barber_payouts',
  'barber_daily_stats',
  'daily_branch_summaries',
  'cash_drawer_sessions',
  'branch_expenses',
  'commission_entries',
  'reviews',
  'barber_portfolios',
  'check_ins',
  'tracking_sessions',
  'chat_messages',
  'appointment_events',
  'appointment_products',
  'appointment_services',
  // invoices referensi payments → hapus invoices dulu
  'invoices',
  // payments referensi appointments → hapus payments dulu
  'payments',
  // appointments referensi barbers, customers → hapus appointments dulu
  'appointments',
  // Inventory & konten
  'branch_inventory',
  'promotions',
  // Katalog (service_prices referensi services)
  'service_prices',
  'services',
  'products',
  // Branch detail
  'branch_photos',
  'branch_operating_hours',
  // barbers referensi branches & staff_users → hapus barbers dulu
  'staff_user_roles',
  'role_permissions',
  'barbers',
  // branches referensi regions → hapus branches dulu
  'branches',
  'regions',
  // Staff & auth
  'staff_users',
  'permissions',
  'roles',
  // Customer
  'customers',
  // Commission rules
  'commission_rules',
];

async function deleteAll(table: string) {
  // Hapus semua baris — supabase-js tidak punya TRUNCATE, pakai DELETE dengan filter universal
  const { error } = await (supabase.from(table) as any)
    .delete()
    .not('id', 'is', null);

  if (error) {
    if (error.code === '42P01') {
      // Tabel tidak ada — skip
      return;
    }
    console.warn(`  ⚠️  ${table}: ${error.message}`);
  } else {
    console.log(`  ✅ ${table}`);
  }
}

async function reset() {
  console.log('⚠️  Menghapus semua data dari database...\n');

  for (const table of TABLE_ORDER) {
    await deleteAll(table);
  }

  console.log('\n🗑️  Selesai. Database bersih dari data.');
  console.log('Jalankan: bun run db:migrate && bun run db:seed:starter\n');
}

reset().catch((err) => {
  console.error('❌ Reset gagal:', err.message || err);
  process.exit(1);
});
