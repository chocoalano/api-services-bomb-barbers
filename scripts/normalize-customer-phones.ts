/**
 * Migrasi data satu-kali: normalkan kolom `customers.phone` yang sudah ada ke
 * bentuk kanonik E.164 (`+62...`), sama seperti yang kini dipakai register/login
 * (lihat src/lib/phone.ts). Tanpa ini, pelanggan lama yang tersimpan sebagai
 * `0812...` tidak akan cocok saat login memakai nomor yang dinormalkan.
 *
 * AMAN secara bawaan:
 *  - DRY-RUN: tanpa argumen, hanya melaporkan rencana perubahan + tabrakan.
 *  - Deteksi tabrakan: bila dua nomor menormal ke nilai yang sama (atau bentrok
 *    dengan nomor lain yang sudah kanonik), baris tsb DILEWATI (tidak di-update)
 *    agar tidak melanggar unique `customers_phone_unique`. Laporkan agar bisa
 *    dibereskan manual.
 *  - Terapkan perubahan hanya dengan flag `--apply`.
 *
 * Jalankan:
 *   bun run scripts/normalize-customer-phones.ts           # dry-run (laporan)
 *   bun run scripts/normalize-customer-phones.ts --apply   # terapkan perubahan
 */
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/lib/db';
import { customers } from '../src/db/schema';
import { normalizePhone } from '../src/lib/phone';

const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await db
    .select({ id: customers.id, phone: customers.phone })
    .from(customers);

  // Peta nomor final (setelah normalisasi) → daftar customer yang memakainya.
  // Nomor yang sudah kanonik & tidak berubah tetap ikut agar tabrakan dengan
  // baris yang akan berubah tetap terdeteksi.
  const finalOwners = new Map<string, string[]>();
  for (const r of rows) {
    const normalized = normalizePhone(r.phone);
    const key = normalized || r.phone; // jaga-jaga bila kosong
    const list = finalOwners.get(key) ?? [];
    list.push(r.id);
    finalOwners.set(key, list);
  }

  const toUpdate: Array<{ id: string; from: string; to: string }> = [];
  const collisions: Array<{ target: string; ids: string[] }> = [];

  for (const r of rows) {
    const normalized = normalizePhone(r.phone);
    if (!normalized || normalized === r.phone) continue; // sudah kanonik / kosong

    const owners = finalOwners.get(normalized) ?? [];
    if (owners.length > 1) {
      // Beberapa customer akan menempati nomor sama → tabrakan unique.
      collisions.push({ target: normalized, ids: owners });
      continue;
    }
    toUpdate.push({ id: r.id, from: r.phone, to: normalized });
  }

  // Dedupe laporan tabrakan.
  const seenCollision = new Set<string>();
  const uniqueCollisions = collisions.filter((c) => {
    if (seenCollision.has(c.target)) return false;
    seenCollision.add(c.target);
    return true;
  });

  console.log(`Total customer      : ${rows.length}`);
  console.log(`Perlu dinormalkan   : ${toUpdate.length}`);
  console.log(`Tabrakan (dilewati) : ${uniqueCollisions.length}`);

  if (uniqueCollisions.length > 0) {
    console.log('\n⚠️  Nomor bertabrakan (perlu dibereskan manual):');
    for (const c of uniqueCollisions) {
      console.log(`  ${c.target}  ← ids: ${c.ids.join(', ')}`);
    }
  }

  if (toUpdate.length > 0) {
    console.log('\nContoh perubahan (maks 20):');
    for (const u of toUpdate.slice(0, 20)) {
      console.log(`  ${u.from}  →  ${u.to}`);
    }
  }

  if (!APPLY) {
    console.log('\nDRY-RUN. Tidak ada perubahan ditulis. Tambahkan --apply untuk menerapkan.');
    return;
  }

  let updated = 0;
  for (const u of toUpdate) {
    await db.update(customers).set({ phone: u.to }).where(eq(customers.id, u.id));
    updated++;
  }
  console.log(`\n✅ Selesai. ${updated} nomor diperbarui.`);
}

main()
  .catch((err) => {
    console.error('Gagal menormalkan nomor:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
