/**
 * Admin Barber Management (HQ catalog) — branch scoping + regresi
 * - POST   /hq/barbers          — create (di-scope per cabang untuk non-global)
 * - PUT    /hq/barbers/:id       — update (scope barber & scope cabang tujuan)
 * - DELETE /hq/barbers/:id       — soft delete (deleted_at), scope per cabang
 *
 * Aturan RBAC yang diuji:
 *   super_admin (global) : kelola barber di cabang manapun
 *   branch_admin         : hanya cabangnya sendiri; create tanpa branch_id → default cabangnya
 *
 * Catatan: fixture barber dibuat langsung via testDb (bukan lewat endpoint create)
 * agar test ringan — endpoint create yang lambat (argon2) hanya dipanggil pada test
 * yang memang menguji POST.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as argon2 from 'argon2';
import { app } from '../src/app';
import { testDb } from '../src/lib/test-db';

const API = '/api/v1';
// Dua cabang yang benar-benar ada di DB target di-resolve saat beforeAll agar test
// tidak bergantung pada ID seed yang mungkin tidak tersedia (login backoffice akan
// ditolak bila branch_admin ditugaskan ke cabang yang tidak eksis).
let ANCOL_BRANCH = '';
let UTARA_BRANCH = '';

const suffix = `${Date.now()}`;
let PW_HASH = '';

let hqToken = '', ancolToken = '', utaraToken = '';
let hqStaffId = '', ancolStaffId = '', utaraStaffId = '';

// Semua barber+staff yang dibuat test → dibersihkan keras di akhir.
const createdBarberIds = new Set<string>();
const createdStaffIds = new Set<string>();

const req = async (method: string, path: string, token?: string, body?: any) => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
  );
  return { status: res.status, body: (await res.json()) as any };
};

const track = (data: any) => {
  if (data?.id) createdBarberIds.add(data.id);
  if (data?.staff_user_id) createdStaffIds.add(data.staff_user_id);
  return data;
};

const createAndLogin = async (email: string, roleName: string, branchId: string | null) => {
  const { data: staff } = await testDb
    .from('staff_users')
    .insert({ full_name: `BM Test ${roleName}`, email, password_hash: PW_HASH })
    .select('id').single();
  const { data: role } = await testDb.from('roles').select('id').eq('name', roleName).single();
  await testDb.from('staff_user_roles').insert({ staff_user_id: staff!.id, role_id: role!.id, branch_id: branchId });
  const login = await req('POST', `${API}/admin/auth/login`, undefined, { email, password: 'BMTest123!' });
  return { id: staff!.id, token: login.body?.data?.accessToken ?? '' };
};

// Fixture barber langsung via testDb (cepat; hash password direuse).
const mkBarber = async (branchId: string, label: string) => {
  const { data: staff } = await testDb
    .from('staff_users')
    .insert({ full_name: `Fix ${label}`, email: `bm_fx_${label}_${suffix}@test.com`, password_hash: PW_HASH })
    .select('id').single();
  const { data: barber } = await testDb
    .from('barbers')
    .insert({ staff_user_id: staff!.id, branch_id: branchId, display_name: `Fix ${label}`, approval_status: 'approved', live_status: 'offline' })
    .select('id, branch_id').single();
  createdStaffIds.add(staff!.id);
  createdBarberIds.add(barber!.id);
  return barber!;
};

beforeAll(async () => {
  PW_HASH = await argon2.hash('BMTest123!');

  // Ambil dua cabang aktif yang berbeda dari DB target.
  const { data: branches } = await testDb
    .from('branches').select('id').is('deleted_at', null).order('id', { ascending: true }).limit(2);
  if (!branches || branches.length < 2) throw new Error('Butuh minimal 2 cabang aktif untuk test scoping barber.');
  ANCOL_BRANCH = branches[0].id;
  UTARA_BRANCH = branches[1].id;

  const hq = await createAndLogin(`bm_hq_${suffix}@test.com`, 'super_admin', null);
  const ancol = await createAndLogin(`bm_ancol_${suffix}@test.com`, 'branch_admin', ANCOL_BRANCH);
  const utara = await createAndLogin(`bm_utara_${suffix}@test.com`, 'branch_admin', UTARA_BRANCH);
  hqToken = hq.token; hqStaffId = hq.id;
  ancolToken = ancol.token; ancolStaffId = ancol.id;
  utaraToken = utara.token; utaraStaffId = utara.id;
});

afterAll(async () => {
  if (createdBarberIds.size) await testDb.from('barbers').delete().in('id', [...createdBarberIds]);
  if (createdStaffIds.size) await testDb.from('staff_users').delete().in('id', [...createdStaffIds]);
  for (const id of [hqStaffId, ancolStaffId, utaraStaffId]) {
    if (!id) continue;
    await testDb.from('staff_user_roles').delete().eq('staff_user_id', id);
    await testDb.from('staff_users').delete().eq('id', id);
  }
});

describe('Prasyarat', () => {
  it('branch_admin memiliki permission manage_barber (seed/migrasi)', async () => {
    const me = await req('GET', `${API}/admin/me`, ancolToken);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain('manage_barber');
  });
});

describe('POST /hq/barbers — create scoping', () => {
  it('super_admin dapat membuat barber di cabang manapun → 201', async () => {
    const { status, body } = await req('POST', `${API}/hq/barbers`, hqToken, {
      full_name: 'HQ Create', email: `bm_hq_c_${suffix}@test.com`, password: 'BMTest123!', branch_id: UTARA_BRANCH
    });
    expect(status).toBe(201);
    expect(track(body.data).branch_id).toBe(UTARA_BRANCH);
  });

  it('branch_admin Ancol dapat membuat barber di cabangnya → 201', async () => {
    const { status, body } = await req('POST', `${API}/hq/barbers`, ancolToken, {
      full_name: 'BA Own', email: `bm_ba_own_${suffix}@test.com`, password: 'BMTest123!', branch_id: ANCOL_BRANCH
    });
    expect(status).toBe(201);
    expect(track(body.data).branch_id).toBe(ANCOL_BRANCH);
  });

  it('branch_admin Ancol tanpa branch_id → default ke cabangnya → 201', async () => {
    const { status, body } = await req('POST', `${API}/hq/barbers`, ancolToken, {
      full_name: 'BA Default', email: `bm_ba_def_${suffix}@test.com`, password: 'BMTest123!'
    });
    expect(status).toBe(201);
    expect(track(body.data).branch_id).toBe(ANCOL_BRANCH);
  });

  it('branch_admin Utara TIDAK bisa membuat barber di cabang Ancol → 403', async () => {
    const { status } = await req('POST', `${API}/hq/barbers`, utaraToken, {
      full_name: 'BA Cross', email: `bm_ba_cross_${suffix}@test.com`, password: 'BMTest123!', branch_id: ANCOL_BRANCH
    });
    expect(status).toBe(403);
  });
});

describe('PUT /hq/barbers/:id — update scoping + regresi bio', () => {
  it('super_admin dapat update display_name → 200', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'upd_hq');
    const { status, body } = await req('PUT', `${API}/hq/barbers/${b.id}`, hqToken, { display_name: 'Updated HQ' });
    expect(status).toBe(200);
    expect(body.data.display_name).toBe('Updated HQ');
  });

  it('REGRESI: update dengan bio null (mengosongkan bio) → 200', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'bionull');
    const { status, body } = await req('PUT', `${API}/hq/barbers/${b.id}`, hqToken, { display_name: 'Bio Null', bio: null });
    expect(status).toBe(200);
    expect(body.data.bio).toBeNull();
  });

  it('branch_admin Ancol dapat update barber cabangnya → 200', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'ba_upd');
    const { status } = await req('PUT', `${API}/hq/barbers/${b.id}`, ancolToken, { display_name: 'BA Updated' });
    expect(status).toBe(200);
  });

  it('branch_admin Utara TIDAK bisa update barber Ancol → 403', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'ba_cross_upd');
    const { status } = await req('PUT', `${API}/hq/barbers/${b.id}`, utaraToken, { display_name: 'HACK' });
    expect(status).toBe(403);
  });

  it('branch_admin Ancol TIDAK bisa memindahkan barber ke cabang lain → 403', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'ba_move');
    const { status } = await req('PUT', `${API}/hq/barbers/${b.id}`, ancolToken, { branch_id: UTARA_BRANCH });
    expect(status).toBe(403);
    const { data } = await testDb.from('barbers').select('branch_id').eq('id', b.id).single();
    expect(data!.branch_id).toBe(ANCOL_BRANCH);
  });

  // Identitas kepster ada di `staff_users`, bukan `barbers`. Sebelum ini seluruh
  // body dialirkan apa adanya ke UPDATE barbers sehingga field akun tidak pernah
  // bisa diubah dari backoffice.
  it('update identitas akun (full_name/email/phone) + radius layanan → 200', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'acc_upd');
    const email = `bm_acc_upd_${suffix}@test.com`;
    const { status, body } = await req('PUT', `${API}/hq/barbers/${b.id}`, hqToken, {
      display_name: 'Akun Updated',
      full_name: 'Nama Baru Kepster',
      email,
      phone: '6281234567890',
      service_radius_km: 9
    });
    expect(status).toBe(200);
    expect(body.data.display_name).toBe('Akun Updated');
    expect(Number(body.data.service_radius_km)).toBe(9);

    const { data: barber } = await testDb.from('barbers').select('staff_user_id').eq('id', b.id).single();
    const { data: staff } = await testDb
      .from('staff_users')
      .select('full_name, email, phone')
      .eq('id', barber!.staff_user_id)
      .single();
    expect(staff!.full_name).toBe('Nama Baru Kepster');
    expect(staff!.email).toBe(email);
    expect(staff!.phone).toBe('6281234567890');
  });

  it('email yang sudah dipakai staff lain → 409 dan data lama tidak berubah', async () => {
    const target = await mkBarber(ANCOL_BRANCH, 'email_dup_a');
    const other = await mkBarber(ANCOL_BRANCH, 'email_dup_b');

    const { data: otherBarber } = await testDb
      .from('barbers').select('staff_user_id').eq('id', other.id).single();
    const { data: otherStaff } = await testDb
      .from('staff_users').select('email').eq('id', otherBarber!.staff_user_id).single();

    const { status } = await req('PUT', `${API}/hq/barbers/${target.id}`, hqToken, {
      full_name: 'Bentrok Email',
      email: otherStaff!.email
    });
    expect(status).toBe(409);

    const { data: targetBarber } = await testDb
      .from('barbers').select('staff_user_id').eq('id', target.id).single();
    const { data: targetStaff } = await testDb
      .from('staff_users').select('full_name, email').eq('id', targetBarber!.staff_user_id).single();
    expect(targetStaff!.email).not.toBe(otherStaff!.email);
    expect(targetStaff!.full_name).not.toBe('Bentrok Email');
  });

  it('radius layanan negatif ditolak → 400', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'radius_neg');
    const { status } = await req('PUT', `${API}/hq/barbers/${b.id}`, hqToken, { service_radius_km: -3 });
    expect(status).toBe(400);
  });

  it('daftar barber HQ menyertakan service_radius_km untuk prefill form edit', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'radius_list');
    await req('PUT', `${API}/hq/barbers/${b.id}`, hqToken, { service_radius_km: 7 });
    const { body } = await req('GET', `${API}/admin/barbers?per_page=100&branch_id=${ANCOL_BRANCH}`, hqToken);
    const row = (body.data ?? []).find((r: any) => r.id === b.id);
    expect(row).toBeDefined();
    expect(Number(row.service_radius_km)).toBe(7);
  });
});

describe('DELETE /hq/barbers/:id — soft delete + scoping', () => {
  it('branch_admin Utara TIDAK bisa hapus barber Ancol → 403', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'del_cross');
    const { status } = await req('DELETE', `${API}/hq/barbers/${b.id}`, utaraToken);
    expect(status).toBe(403);
  });

  it('branch_admin Ancol dapat hapus barber cabangnya → 200 + SOFT delete', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'del_own');
    const { status } = await req('DELETE', `${API}/hq/barbers/${b.id}`, ancolToken);
    expect(status).toBe(200);
    const { data } = await testDb.from('barbers').select('id, deleted_at').eq('id', b.id).maybeSingle();
    expect(data).not.toBeNull();             // baris masih ada (bukan hard delete)
    expect(data!.deleted_at).not.toBeNull(); // ditandai terhapus
  });

  it('barber terhapus tidak muncul di daftar admin', async () => {
    const b = await mkBarber(ANCOL_BRANCH, 'del_list');
    await req('DELETE', `${API}/hq/barbers/${b.id}`, hqToken);
    const { body } = await req('GET', `${API}/admin/barbers?per_page=100&branch_id=${ANCOL_BRANCH}`, hqToken);
    expect((body.data ?? []).some((r: any) => r.id === b.id)).toBe(false);
  });
});
