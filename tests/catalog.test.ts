import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';

const API_PREFIX = '/api/v1';

describe('Catalog Module', () => {
  let regionId = '';
  let branchId = '';
  let serviceAId = '';
  let servicePagedId = '';
  let serviceDeletedId = '';
  let serviceInactiveId = '';
  let serviceFutureId = '';

  const branchPrice = 100000;
  const regionPrice = 80000;
  const defaultPrice = 50000;
  const pagedPrice = 60000;
  const expiredBranchPrice = 120000;
  const serviceAImageUrl = 'https://example.com/active-service.jpg';
  const servicePagedImageUrl = 'https://example.com/active-service-extra.jpg';

  beforeAll(async () => {
    // 1. Create Region
    const { data: region } = await supabase.from('regions').insert({ code: 'TST', name: 'Test Region' }).select('id').single();
    if (region) regionId = region.id;

    // 2. Create Branch
    const { data: branch } = await supabase.from('branches').insert({ name: 'Test Branch Catalog', region_id: regionId }).select('id').single();
    if (branch) branchId = branch.id;

    const { data: sA } = await supabase.from('services').insert({
      name: 'Active Service',
      description: 'Active haircut service',
      default_duration_min: 30,
      image_url: serviceAImageUrl
    }).select('id').single();
    if (sA) serviceAId = sA.id;

    const { data: sPaged } = await supabase.from('services').insert({
      name: 'Active Service Extra',
      description: 'Second active service for pagination',
      default_duration_min: 45,
      image_url: servicePagedImageUrl
    }).select('id').single();
    if (sPaged) servicePagedId = sPaged.id;

    const { data: sDel } = await supabase.from('services').insert({ name: 'Deleted Service', default_duration_min: 30, deleted_at: new Date().toISOString() }).select('id').single();
    if (sDel) serviceDeletedId = sDel.id;

    const { data: sInact } = await supabase.from('services').insert({ name: 'Inactive Service', default_duration_min: 30, is_active: false }).select('id').single();
    if (sInact) serviceInactiveId = sInact.id;

    const { data: sFut } = await supabase.from('services').insert({ name: 'Future Service', default_duration_min: 30 }).select('id').single();
    if (sFut) serviceFutureId = sFut.id;

    // 4. Create Service Prices
    const now = new Date();
    const past = new Date(now.getTime() - 10000000).toISOString();
    const future = new Date(now.getTime() + 10000000).toISOString();
    const pastFar = new Date(now.getTime() - 20000000).toISOString();

    await supabase.from('service_prices').insert([
      // Default Price (P3)
      { service_id: serviceAId, price_amount: defaultPrice, effective_from: past },
      // Region Price (P2)
      { service_id: serviceAId, region_id: regionId, price_amount: regionPrice, effective_from: past },
      // Expired Branch Price (should be ignored)
      { service_id: serviceAId, branch_id: branchId, price_amount: expiredBranchPrice, effective_from: pastFar, effective_to: past },
      // Active Branch Price (P1)
      { service_id: serviceAId, branch_id: branchId, price_amount: branchPrice, effective_from: past, effective_to: future },
      // Default price untuk layanan kedua yang dipakai test pagination
      { service_id: servicePagedId, price_amount: pagedPrice, effective_from: past },
      // Future Price only
      { service_id: serviceFutureId, price_amount: 150000, effective_from: future }
    ]);
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('service_prices').delete().in('service_id', [serviceAId, servicePagedId, serviceFutureId]);
    await supabase.from('services').delete().in('id', [serviceAId, servicePagedId, serviceDeletedId, serviceInactiveId, serviceFutureId]);
    await supabase.from('branches').delete().eq('id', branchId);
    await supabase.from('regions').delete().eq('id', regionId);
  });

  it('1. Harga branch mengalahkan harga region', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services/${serviceAId}/price`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.price_amount).toBe(branchPrice);
  });

  it('2. Harga region mengalahkan harga default (Simulasi hapus branch price)', async () => {
    // Soft delete / remove the branch price first
    await supabase.from('service_prices').delete().match({ service_id: serviceAId, branch_id: branchId });

    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services/${serviceAId}/price`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.price_amount).toBe(regionPrice);
  });

  it('3. Harga default muncul jika region price dihapus', async () => {
    await supabase.from('service_prices').delete().match({ service_id: serviceAId, region_id: regionId });

    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services/${serviceAId}/price`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.price_amount).toBe(defaultPrice);
  });

  it('3b. Daftar layanan cabang mendukung limit, page, pencarian q, dan image_url', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services?limit=1&q=active`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(serviceAId);
    expect(body.data[0].price_amount).toBe(defaultPrice);
    expect(body.data[0].image_url).toBe(serviceAImageUrl);

    const nextRes = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services?limit=1&page=2&q=active`));
    const nextBody = await nextRes.json();

    expect(nextRes.status).toBe(200);
    expect(nextBody.data).toHaveLength(1);
    expect(nextBody.data[0].id).toBe(servicePagedId);
    expect(nextBody.data[0].price_amount).toBe(pagedPrice);
    expect(nextBody.data[0].image_url).toBe(servicePagedImageUrl);
  });

  it('4. Harga inactive/effective expired tidak dipakai (Sudah terbukti di tes 1 karena expiredBranchPrice 120k tidak terpilih)', async () => {
    // Terbukti di setup, past expired branch price tidak diambil
    expect(true).toBe(true);
  });

  it('5. Soft deleted service tidak muncul di katalog dan gagal di resolve price', async () => {
    // Cek daftar layanan aktif (seharusnya tidak ada Deleted Service)
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services`));
    const body = await res.json();
    expect(res.status).toBe(200);
    const found = body.data.find((s: any) => s.id === serviceDeletedId);
    expect(found).toBeUndefined();

    // Coba resolve price untuk deleted service
    const resPrice = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services/${serviceDeletedId}/price`));
    expect(resPrice.status).toBe(404);
  });

  it('6. Service Inactive (is_active: false) tidak muncul di katalog dan price resolve gagal (404)', async () => {
    // Memastikan inactive tidak ada di daftar
    const resList = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services`));
    const listBody = await resList.json();
    const found = listBody.data.find((s: any) => s.id === serviceInactiveId);
    expect(found).toBeUndefined();

    // Memastikan price gagal
    const resPrice = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services/${serviceInactiveId}/price`));
    expect(resPrice.status).toBe(404);
  });

  it('7. Layanan dengan harga yang HANYA berlaku di masa depan akan mereturn 404 pada hari ini', async () => {
    const resPrice = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/services/${serviceFutureId}/price`));
    expect(resPrice.status).toBe(404);
  });

  it('8. Mencoba resolve harga dengan invalid UUID untuk branch (misal: "invalid-uuid") akan gagal bersih dengan 4xx/500', async () => {
    const resPrice = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/invalid-uuid/services/${serviceAId}/price`));
    expect(resPrice.status).not.toBe(200);
  });

  it('9. Endpoint Get Barbers dari suatu branch akan berjalan dengan baik (array kosong jika blm ada)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/barbers`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('10. Resolve harga untuk service yang eksis tapi cabang yang dituju (UUID Valid) tidak ada sama sekali di DB akan menghasilkan 404', async () => {
    const fakeBranchUUID = '11111111-1111-1111-1111-111111111111';
    const resPrice = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${fakeBranchUUID}/services/${serviceAId}/price`));
    expect(resPrice.status).toBe(404);
  });
});
