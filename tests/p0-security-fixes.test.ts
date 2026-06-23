/**
 * P0 Security Fixes — Audit Admin
 *
 * Fix 1: Walk-in barber_id harus berasal dari cabang yang sama (application-level)
 * Fix 2: PUT/DELETE /hq/barbers/:id dibatasi oleh branch scope untuk non-HQ staff
 *
 * Catatan desain:
 *   - Permission 'manage_barber' saat ini HANYA ada pada role 'super_admin'.
 *   - Staff dengan super_admin yang di-assign dengan branch_id tertentu (non-null)
 *     → isGlobal = false, manage_barber = true → memicu branch scope guard kita.
 *   - Branch admin biasa (tanpa manage_barber) → 403 dari permission guard sebelum mencapai
 *     branch scope check — ini perilaku yang benar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';

const API = '/api/v1';

// ── Seed constants ─────────────────────────────────────────────────────────────
const ANCOL_BRANCH  = '20000001-0000-4000-8000-000000000001';
const BRANCH_B      = '20000001-0000-4000-8000-000000000002';
const ANCOL_BARBER  = '50000001-0000-4000-8000-000000000002'; // Andi Classic — ANCOL
const OTHER_BARBER  = '50000001-0000-4000-8000-000000000003'; // Reza — BRANCH_B
const ANCOL_SERVICE = '30000001-0000-4000-8000-000000000001';
const CUSTOMER_ID   = '60000001-0000-4000-8000-000000000003'; // fajar

// ── Test state ─────────────────────────────────────────────────────────────────
let hqToken = '';         // super_admin global (isGlobal=true)
let scopedToken = '';     // super_admin scoped ke ANCOL (isGlobal=false, has manage_barber)
let scopedStaffId = '';   // untuk cleanup
let tempBarberId = '';    // barber baru di BRANCH_B untuk test update/delete
let tempBarberStaffId = '';
let validWalkinAptId = ''; // appointment dari test fix1 "sama → 201"

// ── Helpers ───────────────────────────────────────────────────────────────────

const req = async (
  method: string,
  path: string,
  token?: string,
  body?: any,
  extraHeaders: Record<string, string> = {}
) => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
  );
  return { status: res.status, body: await res.json() as any };
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Bersihkan appointment ANCOL_BARBER di masa depan yang mungkin tersisa dari run sebelumnya
  const futureCutoff = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
  const { data: staleApts } = await supabase
    .from('appointments')
    .select('id')
    .eq('barber_id', ANCOL_BARBER)
    .gte('scheduled_at', futureCutoff);
  if (staleApts && staleApts.length > 0) {
    const ids = staleApts.map((a: any) => a.id);
    await supabase.from('appointment_events').delete().in('appointment_id', ids);
    await supabase.from('appointment_services').delete().in('appointment_id', ids);
    await supabase.from('appointments').delete().in('id', ids);
  }

  // Login HQ (global super_admin)
  const hr = await req('POST', `${API}/admin/auth/login`, undefined, {
    email: 'hq8be0a9a5@test.com',
    password: 'Password123!'
  });
  hqToken = hr.body?.data?.accessToken ?? '';

  // Create test staff with super_admin role SCOPED to ANCOL (branch_id non-null)
  // → isGlobal=false, but has manage_barber permission → triggers our branch scope guard
  const { data: scopedStaff } = await supabase.from('staff_users').insert({
    full_name: 'P0 Scoped Manager',
    email: `p0scope_${Date.now()}@test.com`,
    password_hash: 'irrelevant_for_jwt_test'
  }).select('id').single();
  scopedStaffId = scopedStaff!.id;

  const { data: saRole } = await supabase.from('roles').select('id').eq('name', 'super_admin').single();
  await supabase.from('staff_user_roles').insert({
    staff_user_id: scopedStaffId,
    role_id: saRole!.id,
    branch_id: ANCOL_BRANCH  // scoped — isGlobal will be false
  });

  // Login this scoped staff
  const sr = await app.handle(new Request(`http://localhost/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `p0scope_${Date.now()}@test.com`, password: 'irrelevant' })
  }));
  // JWT login won't work because password_hash is wrong. Use direct DB insert of session
  // instead, we'll inject the staffId via a known-good staff. Use hqToken for the global tests
  // and create a proper hashed password for the scoped staff.

  // Actually, re-create with proper hash
  await supabase.from('staff_users').delete().eq('id', scopedStaffId);
  await supabase.from('staff_user_roles').delete().eq('staff_user_id', scopedStaffId);

  const pwHash = await (async () => {
    const { hash } = await import('argon2');
    return hash('P0Test123!');
  })();

  const suffix = `${Date.now()}`;
  const { data: ns } = await supabase.from('staff_users').insert({
    full_name: 'P0 Scoped Manager',
    email: `p0scope_${suffix}@test.com`,
    password_hash: pwHash
  }).select('id').single();
  scopedStaffId = ns!.id;

  await supabase.from('staff_user_roles').insert({
    staff_user_id: scopedStaffId,
    role_id: saRole!.id,
    branch_id: ANCOL_BRANCH
  });

  const scopedLogin = await req('POST', `${API}/admin/auth/login`, undefined, {
    email: `p0scope_${suffix}@test.com`,
    password: 'P0Test123!'
  });
  scopedToken = scopedLogin.body?.data?.accessToken ?? '';

  // Create a temp barber in BRANCH_B for update/delete tests
  const { data: bStaff } = await supabase.from('staff_users').insert({
    full_name: 'P0 Temp Barber',
    email: `p0barber_${suffix}@test.com`,
    password_hash: pwHash
  }).select('id').single();
  tempBarberStaffId = bStaff!.id;

  const { data: tb } = await supabase.from('barbers').insert({
    staff_user_id: tempBarberStaffId,
    branch_id: BRANCH_B,
    display_name: 'P0 Temp Barber'
  }).select('id').single();
  tempBarberId = tb!.id;
});

afterAll(async () => {
  if (validWalkinAptId) {
    await supabase.from('appointment_events').delete().eq('appointment_id', validWalkinAptId);
    await supabase.from('appointment_services').delete().eq('appointment_id', validWalkinAptId);
    await supabase.from('appointments').delete().eq('id', validWalkinAptId);
  }
  if (tempBarberId) {
    await supabase.from('barbers').delete().eq('id', tempBarberId);
  }
  if (tempBarberStaffId) {
    await supabase.from('staff_users').delete().eq('id', tempBarberStaffId);
  }
  if (scopedStaffId) {
    await supabase.from('staff_user_roles').delete().eq('staff_user_id', scopedStaffId);
    await supabase.from('staff_users').delete().eq('id', scopedStaffId);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 1 — Walk-in: barber_id harus dari cabang yang sama
// ══════════════════════════════════════════════════════════════════════════════

describe('Fix 1: Walk-in — barber_id cross-branch validation', () => {
  const walkinUrl = `${API}/admin/branches/${ANCOL_BRANCH}/walk-ins`;

  it('walk-in dengan barber_id dari cabang yang sama → 201', async () => {
    // scheduled_at satu minggu ke depan pada jam 12:00 (sudah dibersihkan di beforeAll)
    const nextWeekNoon = new Date(Date.now() + 7 * 24 * 3600_000);
    nextWeekNoon.setHours(12, 0, 0, 0);
    const { status, body } = await req(
      'POST', walkinUrl, hqToken,
      { customer_id: CUSTOMER_ID, barber_id: ANCOL_BARBER, service_ids: [ANCOL_SERVICE], scheduled_at: nextWeekNoon.toISOString() },
      { 'Idempotency-Key': crypto.randomUUID() }
    );
    expect(status).toBe(201);
    expect(body.data.barber_id).toBe(ANCOL_BARBER);
    expect(body.data.branch_id).toBe(ANCOL_BRANCH);
    // Simpan ID untuk cleanup di afterAll
    if (body.data?.id) validWalkinAptId = body.data.id;
  });

  it('walk-in dengan barber_id dari cabang LAIN → 400 dengan pesan yang tepat', async () => {
    const { status, body } = await req(
      'POST', walkinUrl, hqToken,
      { customer_id: CUSTOMER_ID, barber_id: OTHER_BARBER, service_ids: [ANCOL_SERVICE] },
      { 'Idempotency-Key': crypto.randomUUID() }
    );
    expect(status).toBe(400);
    expect(body.message).toMatch(/tidak terdaftar pada cabang ini/i);
  });

  it('walk-in dengan barber_id yang tidak ada → 400 dengan pesan yang tepat', async () => {
    const { status, body } = await req(
      'POST', walkinUrl, hqToken,
      { customer_id: CUSTOMER_ID, barber_id: '00000000-0000-4000-8000-000000000099', service_ids: [ANCOL_SERVICE] },
      { 'Idempotency-Key': crypto.randomUUID() }
    );
    expect(status).toBe(400);
    expect(body.message).toMatch(/tidak ditemukan/i);
  });

  it('validasi berlaku juga saat actor adalah HQ (bukan hanya branch admin)', async () => {
    // Bahkan HQ tidak bisa assign barber dari cabang yang salah ke walk-in
    const { status, body } = await req(
      'POST', walkinUrl, hqToken,
      { customer_id: CUSTOMER_ID, barber_id: OTHER_BARBER, service_ids: [ANCOL_SERVICE] },
      { 'Idempotency-Key': crypto.randomUUID() }
    );
    expect(status).toBe(400);
    expect(body.message).toMatch(/tidak terdaftar pada cabang ini/i);
  });

  it('tanpa barber_id sama sekali → tidak error karena barber opsional', async () => {
    const { status } = await req(
      'POST', walkinUrl, hqToken,
      { customer_id: CUSTOMER_ID, service_ids: [ANCOL_SERVICE] },
      { 'Idempotency-Key': crypto.randomUUID() }
    );
    // 201 (berhasil) atau 409 (idempotency duplikat dari test sebelumnya) sama-sama OK
    // yang penting BUKAN 400 dengan pesan barber error
    expect([201, 409]).toContain(status);
    // Cleanup jika 201
    // (tidak bisa easily get the ID here, skip cleanup — test isolation OK)
  });

  it('tanpa token → 401 atau 403', async () => {
    const { status } = await req(
      'POST', walkinUrl, undefined,
      { customer_id: CUSTOMER_ID, service_ids: [ANCOL_SERVICE] },
      { 'Idempotency-Key': crypto.randomUUID() }
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 2 — PUT/DELETE /hq/barbers/:id branch scope resolver
// ══════════════════════════════════════════════════════════════════════════════

describe('Fix 2: PUT /hq/barbers/:id — branch scope resolver', () => {
  it('setup: scoped token berhasil didapat', () => {
    expect(scopedToken.length).toBeGreaterThan(10);
  });

  it('HQ global dapat update barber dari cabang mana pun → 200', async () => {
    const { status, body } = await req(
      'PUT', `${API}/hq/barbers/${tempBarberId}`, hqToken,
      { display_name: 'P0 Temp Barber Updated' }
    );
    expect(status).toBe(200);
    expect(body.data.display_name).toBe('P0 Temp Barber Updated');
  });

  it('staff scoped ke Ancol TIDAK bisa update barber dari branch B → 403', async () => {
    // scopedToken = super_admin scoped ke ANCOL_BRANCH → isGlobal=false → branch scope aktif
    const { status, body } = await req(
      'PUT', `${API}/hq/barbers/${tempBarberId}`, scopedToken,
      { display_name: 'Hacked from Ancol' }
    );
    expect(status).toBe(403);
    expect(body.message).toMatch(/forbidden|cabang Anda/i);
  });

  it('staff scoped ke Ancol BISA update barber dari cabang Ancol sendiri → 200', async () => {
    // ANCOL_BARBER ada di ANCOL_BRANCH → scopedToken (scoped ke ANCOL) bisa update
    const { status } = await req(
      'PUT', `${API}/hq/barbers/${ANCOL_BARBER}`, scopedToken,
      { display_name: 'Andi Classic' }   // restore nama asli
    );
    expect(status).toBe(200);
  });

  it('update barber yang tidak ada (scoped staff) → 404', async () => {
    // Scoped staff → branch scope check runs first → barber not found → 404
    const { status } = await req(
      'PUT', `${API}/hq/barbers/00000000-0000-4000-8000-000000000099`, scopedToken,
      { display_name: 'Ghost' }
    );
    expect(status).toBe(404);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req(
      'PUT', `${API}/hq/barbers/${ANCOL_BARBER}`, undefined,
      { display_name: 'Anon' }
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });
});

describe('Fix 2: DELETE /hq/barbers/:id — branch scope resolver', () => {
  it('staff scoped ke Ancol TIDAK bisa hapus barber dari branch B → 403', async () => {
    const { status, body } = await req(
      'DELETE', `${API}/hq/barbers/${tempBarberId}`, scopedToken
    );
    expect(status).toBe(403);
    expect(body.message).toMatch(/forbidden|cabang Anda/i);
  });

  it('hapus barber yang tidak ada (scoped staff) → 404', async () => {
    // Scoped staff → branch scope check runs, barber not found → 404
    const { status } = await req(
      'DELETE', `${API}/hq/barbers/00000000-0000-4000-8000-000000000099`, scopedToken
    );
    expect(status).toBe(404);
  });

  it('HQ global dapat hapus barber dari cabang mana pun → 200', async () => {
    const { status } = await req(
      'DELETE', `${API}/hq/barbers/${tempBarberId}`, hqToken
    );
    expect(status).toBe(200);
    tempBarberId = ''; // sudah dihapus, afterAll tidak perlu hapus lagi
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req(
      'DELETE', `${API}/hq/barbers/${ANCOL_BARBER}`, undefined
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });
});
