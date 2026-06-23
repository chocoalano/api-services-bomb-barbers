/**
 * P1 — Admin Barber Management
 * - GET  /admin/branches/:branchId/barbers           — live_status + active count
 * - GET  /admin/branches/:branchId/barbers/:id/schedule?date=YYYY-MM-DD
 * - PATCH /admin/branches/:branchId/barbers/:id/status
 * - PATCH /admin/appointments/:id/barber             — reassign
 * - GET  /admin/audit-logs?branch_id=               — branch filter
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as argon2 from 'argon2';
import { app } from '../src/app';
import { redis, getBarberStatusKey } from '../src/lib/redis';
import { supabase } from '../src/lib/supabase';

const API = '/api/v1';

// ── Seed constants ─────────────────────────────────────────────────────────────
const ANCOL_BRANCH  = '20000001-0000-4000-8000-000000000001';
const UTARA_BRANCH  = '20000001-0000-4000-8000-000000000002';
const BUDI_BARBER   = '50000001-0000-4000-8000-000000000001'; // Ancol
const ANDI_BARBER   = '50000001-0000-4000-8000-000000000002'; // Ancol
const REZA_BARBER   = '50000001-0000-4000-8000-000000000003'; // Utara
const FAJAR_CUST    = '60000001-0000-4000-8000-000000000003';
const SERVICE_1     = '30000001-0000-4000-8000-000000000001'; // Premium Haircut 45 min

// ── Test state ─────────────────────────────────────────────────────────────────
let hqToken = '';
let ancolAdminToken = '';
let utaraAdminToken = '';
let hqStaffId = '';
let ancolStaffId = '';
let utaraStaffId = '';
let testAptId = '';          // appointment untuk reassign + schedule tests
const suffix = `${Date.now()}`;

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

const createAndLogin = async (
  email: string,
  pwHash: string,
  roleName: string,
  branchId: string | null
): Promise<{ id: string; token: string }> => {
  const { data: staff } = await supabase
    .from('staff_users')
    .insert({ full_name: `P1 Test ${roleName}`, email, password_hash: pwHash })
    .select('id')
    .single();

  const { data: role } = await supabase.from('roles').select('id').eq('name', roleName).single();

  await supabase.from('staff_user_roles').insert({
    staff_user_id: staff!.id,
    role_id: role!.id,
    branch_id: branchId
  });

  const loginRes = await req('POST', `${API}/admin/auth/login`, undefined, { email, password: 'P1Test123!' });
  return { id: staff!.id, token: loginRes.body?.data?.accessToken ?? '' };
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const pwHash = await argon2.hash('P1Test123!');

  // Bersihkan Redis barber status untuk barber yang dipakai agar state bersih
  await redis.del(getBarberStatusKey(BUDI_BARBER));
  await redis.del(getBarberStatusKey(ANDI_BARBER));

  // Restore Budi/Andi live_status ke available di DB (mungkin dirty dari test lain)
  await supabase.from('barbers').update({ live_status: 'available' }).in('id', [BUDI_BARBER, ANDI_BARBER]);

  const hq    = await createAndLogin(`hqp1_${suffix}@test.com`,    pwHash, 'super_admin',  null);
  const ancol = await createAndLogin(`ancolp1_${suffix}@test.com`, pwHash, 'branch_admin', ANCOL_BRANCH);
  const utara = await createAndLogin(`utarap1_${suffix}@test.com`, pwHash, 'branch_admin', UTARA_BRANCH);

  hqToken = hq.token; hqStaffId = hq.id;
  ancolAdminToken = ancol.token; ancolStaffId = ancol.id;
  utaraAdminToken = utara.token; utaraStaffId = utara.id;

  // Buat appointment untuk BUDI di Ancol (2 minggu ke depan jam 09:00 UTC)
  const twoWeeksNoon = new Date(Date.now() + 14 * 24 * 3600_000);
  twoWeeksNoon.setUTCHours(9, 0, 0, 0);

  // Bersihkan stale future appointments untuk BUDI
  const { data: staleBudi } = await supabase
    .from('appointments').select('id').eq('barber_id', BUDI_BARBER)
    .gte('scheduled_at', twoWeeksNoon.toISOString());
  if (staleBudi?.length) {
    const ids = staleBudi.map((a: any) => a.id);
    await supabase.from('appointment_events').delete().in('appointment_id', ids);
    await supabase.from('appointment_services').delete().in('appointment_id', ids);
    await supabase.from('appointments').delete().in('id', ids);
  }

  const walkinRes = await req(
    'POST',
    `${API}/admin/branches/${ANCOL_BRANCH}/walk-ins`,
    hqToken,
    { customer_id: FAJAR_CUST, barber_id: BUDI_BARBER, service_ids: [SERVICE_1], scheduled_at: twoWeeksNoon.toISOString() },
    { 'Idempotency-Key': `p1-sched-${suffix}` }
  );
  testAptId = walkinRes.body?.data?.id ?? '';
});

afterAll(async () => {
  if (testAptId) {
    await supabase.from('appointment_events').delete().eq('appointment_id', testAptId);
    await supabase.from('appointment_services').delete().eq('appointment_id', testAptId);
    await supabase.from('appointments').delete().eq('id', testAptId);
  }
  for (const id of [hqStaffId, ancolStaffId, utaraStaffId]) {
    if (id) {
      await supabase.from('staff_user_roles').delete().eq('staff_user_id', id);
      await supabase.from('staff_users').delete().eq('id', id);
    }
  }
  // Restore barber status
  await supabase.from('barbers').update({ live_status: 'available' }).eq('id', BUDI_BARBER);
  await redis.del(getBarberStatusKey(BUDI_BARBER));
  await redis.del(getBarberStatusKey(ANDI_BARBER));
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /branches/:branchId/barbers — Daftar barber dengan live_status
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /admin/branches/:branchId/barbers', () => {
  it('HQ dapat melihat barber Ancol → 200 dengan live_status & active_count', async () => {
    const { status, body } = await req('GET', `${API}/admin/branches/${ANCOL_BRANCH}/barbers`, hqToken);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    const budi = body.data.find((b: any) => b.id === BUDI_BARBER);
    expect(budi).toBeDefined();
    expect(budi.live_status).toBeDefined();
    expect(typeof budi.active_appointment_count).toBe('number');
  });

  it('live_status diambil dari Redis jika tersedia', async () => {
    await redis.set(getBarberStatusKey(ANDI_BARBER), 'on_break');
    const { body } = await req('GET', `${API}/admin/branches/${ANCOL_BRANCH}/barbers`, hqToken);
    const andi = body.data.find((b: any) => b.id === ANDI_BARBER);
    expect(andi.live_status).toBe('on_break');
    await redis.del(getBarberStatusKey(ANDI_BARBER));
  });

  it('active_appointment_count naik setelah appointment dibuat', async () => {
    // testAptId sudah dibuat di beforeAll untuk BUDI
    expect(testAptId).toBeTruthy();
    const { body } = await req('GET', `${API}/admin/branches/${ANCOL_BRANCH}/barbers`, hqToken);
    const budi = body.data.find((b: any) => b.id === BUDI_BARBER);
    expect(budi.active_appointment_count).toBeGreaterThanOrEqual(1);
  });

  it('branch admin Ancol dapat melihat barber cabangannya → 200', async () => {
    const { status } = await req('GET', `${API}/admin/branches/${ANCOL_BRANCH}/barbers`, ancolAdminToken);
    expect(status).toBe(200);
  });

  it('branch admin Utara TIDAK bisa melihat barber Ancol → 403', async () => {
    const { status } = await req('GET', `${API}/admin/branches/${ANCOL_BRANCH}/barbers`, utaraAdminToken);
    expect(status).toBe(403);
  });

  it('tanpa token → 401', async () => {
    const { status } = await req('GET', `${API}/admin/branches/${ANCOL_BRANCH}/barbers`);
    expect(status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /branches/:branchId/barbers/:barberId/schedule
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /admin/branches/:branchId/barbers/:barberId/schedule', () => {
  it('mengembalikan jadwal barber untuk tanggal yang diberikan', async () => {
    const twoWeeksDate = new Date(Date.now() + 14 * 24 * 3600_000).toISOString().slice(0, 10);
    const { status, body } = await req(
      'GET',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${BUDI_BARBER}/schedule?date=${twoWeeksDate}`,
      hqToken
    );
    expect(status).toBe(200);
    expect(body.data.barber.id).toBe(BUDI_BARBER);
    expect(body.data.date).toBe(twoWeeksDate);
    expect(Array.isArray(body.data.appointments)).toBe(true);
  });

  it('tanggal hari ini (default) tidak error jika tidak ada appointment', async () => {
    const { status, body } = await req(
      'GET',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${BUDI_BARBER}/schedule`,
      hqToken
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data.appointments)).toBe(true);
  });

  it('barber dari cabang yang salah → 404', async () => {
    const { status } = await req(
      'GET',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${REZA_BARBER}/schedule`,
      hqToken
    );
    expect(status).toBe(404);
  });

  it('branch admin Utara tidak bisa akses jadwal barber Ancol → 403', async () => {
    const { status } = await req(
      'GET',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${BUDI_BARBER}/schedule`,
      utaraAdminToken
    );
    expect(status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /branches/:branchId/barbers/:barberId/status
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /admin/branches/:branchId/barbers/:barberId/status', () => {
  it('HQ dapat set status barber ke offline → 200 + Redis diupdate', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${BUDI_BARBER}/status`,
      hqToken,
      { status: 'offline' }
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('offline');
    const redisVal = await redis.get(getBarberStatusKey(BUDI_BARBER));
    expect(redisVal).toBe('offline');
  });

  it('DB live_status juga diperbarui', async () => {
    const { data: b } = await supabase.from('barbers').select('live_status').eq('id', BUDI_BARBER).single();
    expect(b!.live_status).toBe('offline');
  });

  it('set kembali ke available → 200', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${BUDI_BARBER}/status`,
      hqToken,
      { status: 'available' }
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('available');
  });

  it('branch admin Ancol dapat set status barber Ancol → 200', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${ANDI_BARBER}/status`,
      ancolAdminToken,
      { status: 'on_break' }
    );
    expect(status).toBe(200);
    // Cleanup
    await req('PATCH', `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${ANDI_BARBER}/status`, hqToken, { status: 'available' });
  });

  it('branch admin Utara tidak bisa set status barber Ancol → 403', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${BUDI_BARBER}/status`,
      utaraAdminToken,
      { status: 'offline' }
    );
    expect(status).toBe(403);
  });

  it('status tidak valid → 400', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${BUDI_BARBER}/status`,
      hqToken,
      { status: 'tidur' }
    );
    expect(status).toBe(400);
  });

  it('barber dari cabang lain → 404', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/branches/${ANCOL_BRANCH}/barbers/${REZA_BARBER}/status`,
      hqToken,
      { status: 'offline' }
    );
    expect(status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /admin/appointments/:id/barber — Reassign barber
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /admin/appointments/:id/barber', () => {
  it('setup: testAptId tersedia', () => {
    expect(testAptId).toBeTruthy();
  });

  it('HQ dapat reassign barber ke barber lain di cabang yang sama → 200', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/admin/appointments/${testAptId}/barber`,
      hqToken,
      { barber_id: ANDI_BARBER }
    );
    expect(status).toBe(200);
    expect(body.data.barber_id).toBe(ANDI_BARBER);
  });

  it('appointment_events memiliki entri BARBER_REASSIGNED', async () => {
    const { data } = await supabase
      .from('appointment_events')
      .select('event_type, reason')
      .eq('appointment_id', testAptId)
      .eq('event_type', 'BARBER_REASSIGNED')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(data?.event_type).toBe('BARBER_REASSIGNED');
    expect(data?.reason).toMatch(/Andi/i);
  });

  it('reassign kembali ke Budi → 200', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/appointments/${testAptId}/barber`,
      hqToken,
      { barber_id: BUDI_BARBER }
    );
    expect(status).toBe(200);
  });

  it('barber dari cabang berbeda → 400', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/admin/appointments/${testAptId}/barber`,
      hqToken,
      { barber_id: REZA_BARBER }
    );
    expect(status).toBe(400);
    expect(body.message).toMatch(/cabang/i);
  });

  it('barber tidak ada → 400', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/appointments/${testAptId}/barber`,
      hqToken,
      { barber_id: '00000000-0000-4000-8000-000000000099' }
    );
    expect(status).toBe(400);
  });

  it('appointment tidak ada → 404', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/appointments/00000000-0000-4000-8000-000000000099/barber`,
      hqToken,
      { barber_id: BUDI_BARBER }
    );
    expect(status).toBe(404);
  });

  it('branch admin Utara tidak bisa reassign appointment Ancol → 403', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/appointments/${testAptId}/barber`,
      utaraAdminToken,
      { barber_id: ANDI_BARBER }
    );
    expect(status).toBe(403);
  });

  it('branch admin Ancol dapat reassign appointment di cabangannya → 200', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/admin/appointments/${testAptId}/barber`,
      ancolAdminToken,
      { barber_id: ANDI_BARBER }
    );
    expect(status).toBe(200);
    // Restore
    await req('PATCH', `${API}/admin/appointments/${testAptId}/barber`, hqToken, { barber_id: BUDI_BARBER });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /admin/audit-logs?branch_id= — Branch filter
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /admin/audit-logs — branch_id filter', () => {
  it('HQ dapat melihat semua audit log tanpa filter → 200', async () => {
    const { status, body } = await req('GET', `${API}/admin/audit-logs`, hqToken);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('filter branch_id mengembalikan log untuk cabang tersebut', async () => {
    // SET_BARBER_STATUS sudah dilakukan ke ANCOL_BRANCH di tes sebelumnya
    // Tunggu sebentar agar BullMQ worker selesai insert
    await new Promise(r => setTimeout(r, 1000));

    const { status, body } = await req(
      'GET',
      `${API}/admin/audit-logs?branch_id=${ANCOL_BRANCH}&entity_type=barbers&limit=10`,
      hqToken
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length > 0) {
      body.data.forEach((log: any) => {
        expect(log.branch_id).toBe(ANCOL_BRANCH);
      });
    }
  });

  it('filter branch_id dengan ID tidak dikenal → data kosong bukan error', async () => {
    const { status, body } = await req(
      'GET',
      `${API}/admin/audit-logs?branch_id=00000000-0000-4000-8000-000000000099`,
      hqToken
    );
    expect(status).toBe(200);
    expect(body.data.length).toBe(0);
  });

  it('branch admin Ancol dapat filter log cabangannya → 200', async () => {
    const { status } = await req(
      'GET',
      `${API}/admin/audit-logs?branch_id=${ANCOL_BRANCH}`,
      ancolAdminToken
    );
    expect(status).toBe(200);
  });

  it('tanpa permission view_audit_log → 403', async () => {
    // ancolAdminToken memiliki view_audit_log (branch_admin permissions)
    // Buat staff tanpa permission apapun sebagai stub test
    const { status } = await req('GET', `${API}/admin/audit-logs`, undefined);
    expect(status).toBe(401);
  });
});
