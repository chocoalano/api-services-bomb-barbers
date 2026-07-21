/**
 * [G2] Suspend/reject yang benar-benar berefek.
 *
 * Sebelum perbaikan ini, `setBarberApproval('reject')` hanya meng-UPDATE kolom:
 * kepster yang baru ditolak tetap bisa menerima order, chat, dan memanggil
 * /withdraw dengan token lamanya, bahkan bisa memperpanjang sesinya lewat
 * refresh selamanya. Tes ini mengunci penutupan lubang itu — sekaligus menjaga
 * agar pencabutan TIDAK bocor ke akun lain.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as argon2 from 'argon2';
import { app } from '../src/app';
import { testDb } from '../src/lib/test-db';
import { redis } from '../src/lib/redis';
import { SessionErrorCode } from '../src/core/auth/session-errors';

const API = '/api/v1';
const PASSWORD = 'RevokeTest123!';
const suffix = crypto.randomUUID().split('-')[0];

let branchId = '';
let pwHash = '';
let hqStaffId = '';
let hqToken = '';
const createdStaffIds = new Set<string>();
const createdBarberIds = new Set<string>();
let customerId = '';

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

/** Buat kepster approved + login, kembalikan token & id-nya. */
const makeBarber = async (label: string) => {
  const email = `revoke_${label}_${suffix}@test.com`;
  const { data: staff } = await testDb
    .from('staff_users')
    .insert({ full_name: `Revoke ${label}`, email, password_hash: pwHash, is_active: true })
    .select('id')
    .single();
  const { data: barber } = await testDb
    .from('barbers')
    .insert({
      staff_user_id: staff!.id,
      branch_id: branchId,
      display_name: `Revoke ${label}`,
      approval_status: 'approved',
      live_status: 'offline'
    })
    .select('id')
    .single();
  createdStaffIds.add(staff!.id);
  createdBarberIds.add(barber!.id);

  const login = await req('POST', `${API}/barbers/auth/login`, undefined, {
    email,
    password: PASSWORD
  });
  expect(login.status).toBe(200);
  return {
    staffId: staff!.id,
    barberId: barber!.id,
    accessToken: login.body.data.accessToken as string,
    refreshToken: login.body.data.refreshToken as string
  };
};

beforeAll(async () => {
  pwHash = await argon2.hash(PASSWORD);

  const { data: branches } = await testDb
    .from('branches')
    .select('id')
    .is('deleted_at', null)
    .limit(1);
  if (!branches?.length) throw new Error('Butuh minimal 1 cabang aktif.');
  branchId = branches[0].id;

  // Admin HQ untuk memanggil endpoint approval/suspend.
  const { data: staff } = await testDb
    .from('staff_users')
    .insert({
      full_name: 'Revoke HQ',
      email: `revoke_hq_${suffix}@test.com`,
      password_hash: pwHash
    })
    .select('id')
    .single();
  hqStaffId = staff!.id;
  const { data: role } = await testDb
    .from('roles')
    .select('id')
    .eq('name', 'super_admin')
    .single();
  await testDb
    .from('staff_user_roles')
    .insert({ staff_user_id: hqStaffId, role_id: role!.id, branch_id: null });
  const login = await req('POST', `${API}/admin/auth/login`, undefined, {
    email: `revoke_hq_${suffix}@test.com`,
    password: PASSWORD
  });
  hqToken = login.body?.data?.accessToken ?? '';
  expect(hqToken).toBeTruthy();
});

afterAll(async () => {
  if (createdBarberIds.size) {
    await testDb.from('barbers').delete().in('id', [...createdBarberIds]);
  }
  const allStaff = [...createdStaffIds, hqStaffId].filter(Boolean);
  for (const id of allStaff) {
    await testDb.from('auth_sessions' as any).delete().eq('user_id', id);
    await testDb.from('auth_events' as any).delete().eq('user_id', id);
    await testDb.from('staff_user_roles').delete().eq('staff_user_id', id);
  }
  if (allStaff.length) {
    await testDb.from('staff_users').delete().in('id', allStaff);
  }
  if (customerId) {
    await testDb.from('auth_sessions' as any).delete().eq('user_id', customerId);
    await testDb.from('auth_events' as any).delete().eq('user_id', customerId);
    await testDb.from('customers').delete().eq('id', customerId);
  }
});

describe('[G2] kepster ditolak admin', () => {
  it('token lama langsung mati & refresh ditolak ACCOUNT_REJECTED', async () => {
    const barber = await makeBarber('reject');

    // Sebelum ditolak: akses normal.
    const before = await req('GET', `${API}/barbers/me`, barber.accessToken);
    expect(before.status).toBe(200);

    const reject = await req(
      'PATCH',
      `${API}/hq/barbers/${barber.barberId}/approval`,
      hqToken,
      { action: 'reject' }
    );
    expect(reject.status).toBe(200);

    // Access token lama: sesinya sudah dicabut.
    const after = await req('GET', `${API}/barbers/me`, barber.accessToken);
    expect(after.status).toBe(401);

    // Refresh: ditolak dengan kode terminal + pesan yang bisa ditampilkan.
    const refreshed = await req('POST', `${API}/barbers/auth/refresh`, undefined, {
      refreshToken: barber.refreshToken
    });
    expect(refreshed.status).toBe(403);
    expect(refreshed.body.code).toBe(SessionErrorCode.ACCOUNT_REJECTED);
    expect(refreshed.body.message).toBeTruthy();
  });

  it('login ulang pun ditolak (gate lama tetap berlaku)', async () => {
    const email = `revoke_reject2_${suffix}@test.com`;
    const { data: staff } = await testDb
      .from('staff_users')
      .insert({ full_name: 'Revoke Reject2', email, password_hash: pwHash })
      .select('id')
      .single();
    const { data: barber } = await testDb
      .from('barbers')
      .insert({
        staff_user_id: staff!.id,
        branch_id: branchId,
        display_name: 'Revoke Reject2',
        approval_status: 'rejected',
        live_status: 'offline'
      })
      .select('id')
      .single();
    createdStaffIds.add(staff!.id);
    createdBarberIds.add(barber!.id);

    const login = await req('POST', `${API}/barbers/auth/login`, undefined, {
      email,
      password: PASSWORD
    });
    expect(login.status).toBe(403);
  });
});

describe('[G2] kepster dihapus admin', () => {
  it('sesi dicabut saat profil barber di-soft-delete', async () => {
    const barber = await makeBarber('delete');
    expect((await req('GET', `${API}/barbers/me`, barber.accessToken)).status).toBe(200);

    const deleted = await req('DELETE', `${API}/hq/barbers/${barber.barberId}`, hqToken);
    expect(deleted.status).toBe(200);

    expect((await req('GET', `${API}/barbers/me`, barber.accessToken)).status).toBe(401);

    const refreshed = await req('POST', `${API}/barbers/auth/refresh`, undefined, {
      refreshToken: barber.refreshToken
    });
    expect(refreshed.status).toBe(403);
    expect(refreshed.body.code).toBe(SessionErrorCode.ACCOUNT_REJECTED);
  });
});

describe('[G2] akun dinonaktifkan', () => {
  it('suspend kepster mencabut sesi dengan kode ACCOUNT_SUSPENDED', async () => {
    const barber = await makeBarber('suspend');
    expect((await req('GET', `${API}/barbers/me`, barber.accessToken)).status).toBe(200);

    const suspend = await req(
      'PATCH',
      `${API}/hq/barbers/${barber.barberId}/active`,
      hqToken,
      { is_active: false, reason: 'uji coba' }
    );
    expect(suspend.status).toBe(200);

    expect((await req('GET', `${API}/barbers/me`, barber.accessToken)).status).toBe(401);

    const refreshed = await req('POST', `${API}/barbers/auth/refresh`, undefined, {
      refreshToken: barber.refreshToken
    });
    expect(refreshed.status).toBe(403);
    expect(refreshed.body.code).toBe(SessionErrorCode.ACCOUNT_SUSPENDED);
  });

  it('suspend pelanggan mencabut sesinya juga', async () => {
    const email = `revoke_cust_${suffix}@test.com`;
    const { data: customer } = await testDb
      .from('customers')
      .insert({
        full_name: 'Revoke Customer',
        email,
        phone: `906${suffix}`,
        password_hash: pwHash
      })
      .select('id')
      .single();
    customerId = customer!.id;

    const login = await req('POST', `${API}/customers/auth/login`, undefined, {
      email,
      password: PASSWORD
    });
    expect(login.status).toBe(200);
    const { accessToken, refreshToken } = login.body.data;

    expect((await req('GET', `${API}/customer/me`, accessToken)).status).toBe(200);

    const suspend = await req(
      'PATCH',
      `${API}/hq/customers/${customerId}/active`,
      hqToken,
      { is_active: false }
    );
    expect(suspend.status).toBe(200);

    expect((await req('GET', `${API}/customer/me`, accessToken)).status).toBe(401);

    const refreshed = await req('POST', `${API}/customers/auth/refresh`, undefined, {
      refreshToken
    });
    expect(refreshed.status).toBe(403);
    expect(refreshed.body.code).toBe(SessionErrorCode.ACCOUNT_SUSPENDED);

    // Aktifkan kembali agar cleanup rapi; sesi lama TIDAK dipulihkan.
    await req('PATCH', `${API}/hq/customers/${customerId}/active`, hqToken, {
      is_active: true
    });
  });
});

describe('[G2] pencabutan tidak boleh bocor ke akun lain', () => {
  it('kepster lain & admin yang menjalankan aksi tetap login', async () => {
    const victim = await makeBarber('victim');
    const bystander = await makeBarber('bystander');

    const reject = await req(
      'PATCH',
      `${API}/hq/barbers/${victim.barberId}/approval`,
      hqToken,
      { action: 'reject' }
    );
    expect(reject.status).toBe(200);

    expect((await req('GET', `${API}/barbers/me`, victim.accessToken)).status).toBe(401);
    expect((await req('GET', `${API}/barbers/me`, bystander.accessToken)).status).toBe(200);
    // Sesi admin yang menekan tombol tidak boleh ikut mati.
    expect((await req('GET', `${API}/admin/me`, hqToken)).status).toBe(200);
  });
});

describe('[G2] cache tidak menahan pencabutan', () => {
  it('pencabutan menghapus cache sesi (bukan menunggu TTL 5 menit)', async () => {
    const barber = await makeBarber('cache');
    // Panaskan cache lebih dulu.
    expect((await req('GET', `${API}/barbers/me`, barber.accessToken)).status).toBe(200);

    await req('PATCH', `${API}/hq/barbers/${barber.barberId}/approval`, hqToken, {
      action: 'reject'
    });

    const { data: sessions } = await testDb
      .from('auth_sessions' as any)
      .select('id, revoked_at, revoke_reason')
      .eq('user_id', barber.staffId);

    expect(sessions?.length).toBeGreaterThan(0);
    for (const session of sessions ?? []) {
      expect(session.revoked_at).toBeTruthy();
      expect(session.revoke_reason).toBe('account_rejected');
      expect(await redis.get(`auth:session:${session.id}`)).toBeNull();
    }
  });
});
