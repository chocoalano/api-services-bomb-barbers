// ============================================================================
// REGRESI: DAFTAR BARBER CABANG HARUS MEMUAT BARBER YANG SEDANG TIDAK IDLE
// ----------------------------------------------------------------------------
// Endpoint katalog dulu memfilter `live_status` sehingga hanya barber
// 'available' yang dikirim. Di produksi kolom itu default 'offline' sampai
// barber menyalakan switch-nya (dan menjadi 'serving' selama melayani), jadi
// app customer selalu menerima array kosong dan menampilkan "Barber tidak
// tersedia" — sekaligus membuat badge kehadiran realtime mustahil karena barber
// offline tidak pernah ada di daftar untuk diberi badge.
//
// Ketersediaan tetap ditegakkan di aturan slot (`evaluateBarber`), bukan dengan
// menyembunyikan barber dari katalog.
// ============================================================================

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { testDb } from '../src/lib/test-db';

const API_PREFIX = '/api/v1';
const BRANCH_LAT = -6.260721;
const BRANCH_LNG = 106.813911;

const fetchBarbers = async (branchId: string, query = '') => {
  const res = await app.handle(
    new Request(
      `http://localhost${API_PREFIX}/customers/catalog/branches/${branchId}/barbers${query}`
    )
  );
  const body = await res.json();
  return { status: res.status, data: body.data as any[] };
};

describe('Katalog barber cabang — kehadiran tidak menyembunyikan barber', () => {
  let regionId = '';
  let branchId = '';
  const staffIds: string[] = [];
  const barberIds: Record<string, string> = {};

  const seedBarber = async (name: string, liveStatus: string) => {
    const { data: staff } = await testDb
      .from('staff_users')
      .insert({
        full_name: name,
        email: `${name.toLowerCase().replace(/\s+/g, '-')}-presence@test.local`,
        is_active: true
      })
      .select('id')
      .single();
    staffIds.push(staff!.id);

    const { data: barber } = await testDb
      .from('barbers')
      .insert({
        staff_user_id: staff!.id,
        branch_id: branchId,
        display_name: name,
        live_status: liveStatus,
        approval_status: 'approved',
        service_radius_km: 10
      })
      .select('id')
      .single();
    barberIds[name] = barber!.id;
  };

  beforeAll(async () => {
    const { data: region } = await testDb
      .from('regions')
      .insert({ code: 'PRS', name: 'Region Presence' })
      .select('id')
      .single();
    regionId = region!.id;

    const { data: branch } = await testDb
      .from('branches')
      .insert({
        name: 'Branch Presence',
        region_id: regionId,
        latitude: BRANCH_LAT,
        longitude: BRANCH_LNG,
        is_active: true
      })
      .select('id')
      .single();
    branchId = branch!.id;

    // Satu barber per status kanonik yang mungkin ditemui di produksi.
    await seedBarber('Zulu Available', 'available');
    await seedBarber('Alpha Offline', 'offline');
    await seedBarber('Bravo Serving', 'serving');
    await seedBarber('Charlie On Break', 'on_break');
  });

  afterAll(async () => {
    await testDb.from('barbers').delete().in('id', Object.values(barberIds));
    await testDb.from('staff_users').delete().in('id', staffIds);
    await testDb.from('branches').delete().eq('id', branchId);
    await testDb.from('regions').delete().eq('id', regionId);
  });

  it('jalur tanpa koordinat memuat seluruh barber apa pun live_status-nya', async () => {
    const { status, data } = await fetchBarbers(branchId);

    expect(status).toBe(200);
    expect(data.map((b) => b.id).sort()).toEqual(
      Object.values(barberIds).sort()
    );
  });

  it('jalur ber-koordinat (dipakai app customer) juga memuat barber offline', async () => {
    const { status, data } = await fetchBarbers(
      branchId,
      `?latitude=${BRANCH_LAT}&longitude=${BRANCH_LNG}`
    );

    expect(status).toBe(200);
    expect(data.map((b) => b.id).sort()).toEqual(
      Object.values(barberIds).sort()
    );
  });

  it('mengirim live_status kanonik + flag is_online untuk badge kehadiran', async () => {
    const { data } = await fetchBarbers(
      branchId,
      `?latitude=${BRANCH_LAT}&longitude=${BRANCH_LNG}`
    );
    const byId = new Map(data.map((b) => [b.id, b]));

    expect(byId.get(barberIds['Zulu Available'])).toMatchObject({
      live_status: 'available',
      is_online: true
    });
    expect(byId.get(barberIds['Alpha Offline'])).toMatchObject({
      live_status: 'offline',
      is_online: false
    });
    expect(byId.get(barberIds['Bravo Serving'])).toMatchObject({
      live_status: 'serving',
      is_online: false
    });
    expect(byId.get(barberIds['Charlie On Break'])).toMatchObject({
      live_status: 'on_break',
      is_online: false
    });
  });

  it('barber siap-terima-order diurutkan lebih dulu, sisanya by nama', async () => {
    for (const query of ['', `?latitude=${BRANCH_LAT}&longitude=${BRANCH_LNG}`]) {
      const { data } = await fetchBarbers(branchId, query);
      // 'Zulu Available' huruf terakhir alfabet: ia bisa berada di depan HANYA
      // karena kehadiran, bukan kebetulan urutan nama.
      expect(data.map((b) => b.display_name)).toEqual([
        'Zulu Available',
        'Alpha Offline',
        'Bravo Serving',
        'Charlie On Break'
      ]);
    }
  });

  it('jalur ber-koordinat mengirim profil yang sama dengan jalur tanpa koordinat', async () => {
    const { data: plain } = await fetchBarbers(branchId);
    const { data: geo } = await fetchBarbers(
      branchId,
      `?latitude=${BRANCH_LAT}&longitude=${BRANCH_LNG}`
    );

    const pick = (rows: any[]) =>
      rows
        .map((b) => ({
          id: b.id,
          display_name: b.display_name,
          rating_avg: b.rating_avg,
          rating_count: b.rating_count
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(pick(geo)).toEqual(pick(plain));
  });
});
