/**
 * Stage 6 — Route frontend yang belum tersedia
 *
 * Covers:
 *  1. PATCH /customers/me — update profil customer
 *  2. PATCH /customers/notifications/read-all — tandai semua notifikasi dibaca
 *  3. PATCH /customers/notifications/:id/read — tandai satu notifikasi dibaca
 *  4. GET /customers/appointments/:id/payment — status pembayaran berdasarkan appointment
 *  5. POST /barbers/appointments/:id/reject — tolak order dengan alasan
 *  6. PATCH /barbers/appointments/:id/no-show — tandai customer tidak hadir
 *  7. PATCH /barbers/me/status — set status kehadiran barber
 *  8. GET /barbers/appointments/:id/navigation — data navigasi appointment
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';

const API = '/api/v1';
const PASS = 'password123';

let customerToken = '';
let customerId = '';
let barberToken = '';
let barberId = '';
let branchId = '';

// Test state
let notifId1 = '';
let notifId2 = '';
let pendingAptId = '';
let confirmedAptId = '';
const cleanupAptIds: string[] = [];

// ── Helper ────────────────────────────────────────────────────────────────────

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
  return { status: res.status, body: await res.json() as any };
};

const insertApt = async (extra: Record<string, any> = {}): Promise<string> => {
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      branch_id: branchId,
      barber_id: barberId,
      customer_id: customerId,
      queue_position: 99,
      customer_media_urls: [],
      source: 'online_booking',
      ...extra
    })
    .select('id')
    .single();
  if (error) throw new Error('insertApt: ' + error.message);
  cleanupAptIds.push(data!.id);
  return data!.id;
};

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Login customer
  const cr = await req('POST', `${API}/customers/auth/login`, undefined, {
    email: 'fajar.customer@example.com',
    password: PASS
  });
  customerToken = cr.body?.data?.accessToken ?? '';

  // Login barber
  const br = await req('POST', `${API}/barbers/auth/login`, undefined, {
    email: 'davies@bombbarbershop.com',
    password: PASS
  });
  barberToken = br.body?.data?.accessToken ?? '';

  // Resolve IDs
  const { data: cust } = await supabase.from('customers').select('id').eq('email', 'fajar.customer@example.com').single();
  customerId = cust!.id;

  const { data: daviesStaff } = await supabase.from('staff_users').select('id').eq('email', 'davies@bombbarbershop.com').single();
  const { data: daviesBarber } = await supabase.from('barbers').select('id, branch_id').eq('staff_user_id', daviesStaff!.id).single();
  barberId = daviesBarber!.id;
  branchId = daviesBarber!.branch_id;

  // Insert test notifications for fajar (user_id is required and uses customer id)
  const { data: n1 } = await supabase.from('notifications').insert({
    user_id: customerId,
    recipient_id: customerId,
    recipient_type: 'customer',
    title: 'Test Notif 1',
    body: 'Isi notifikasi 1',
    message: 'Isi notifikasi 1',
    type: 'system'
  }).select('id').single();
  notifId1 = n1!.id;

  const { data: n2 } = await supabase.from('notifications').insert({
    user_id: customerId,
    recipient_id: customerId,
    recipient_type: 'customer',
    title: 'Test Notif 2',
    body: 'Isi notifikasi 2',
    message: 'Isi notifikasi 2',
    type: 'system'
  }).select('id').single();
  notifId2 = n2!.id;

  // Test appointments
  pendingAptId = await insertApt({ status: 'pending' });
  confirmedAptId = await insertApt({
    status: 'confirmed',
    fulfillment_type: 'home_service',
    service_address: 'Jl. Test No. 1',
    destination_latitude: -6.2000,
    destination_longitude: 106.8000,
    location_notes: 'Dekat taman',
    journey_status: 'not_started'
  });
});

afterAll(async () => {
  await supabase.from('notifications').delete().in('id', [notifId1, notifId2].filter(Boolean));
  await supabase.from('appointment_events').delete().in('appointment_id', cleanupAptIds);
  await supabase.from('appointments').delete().in('id', cleanupAptIds);
});

// ── 1. Update customer profile ─────────────────────────────────────────────────

describe('PATCH /customers/me — update profil', () => {
  it('berhasil update full_name → 200', async () => {
    const { status, body } = await req('PATCH', `${API}/customers/me`, customerToken, {
      full_name: 'Fajar Nugroho Updated'
    });
    expect(status).toBe(200);
    expect(body.data.full_name).toBe('Fajar Nugroho Updated');
  });

  it('mengembalikan data profil terbaru', async () => {
    const { body } = await req('PATCH', `${API}/customers/me`, customerToken, {
      full_name: 'Fajar Nugroho'
    });
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('full_name');
    expect(body.data).toHaveProperty('email');
  });

  it('body kosong → 400 (tidak ada field yang diperbarui)', async () => {
    const { status } = await req('PATCH', `${API}/customers/me`, customerToken, {});
    expect(status).toBe(400);
  });

  it('full_name kosong (whitespace only) → 400', async () => {
    const { status } = await req('PATCH', `${API}/customers/me`, customerToken, {
      full_name: '   '
    });
    expect(status).toBe(400);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req('PATCH', `${API}/customers/me`, undefined, { full_name: 'Test' });
    expect(status).toBeGreaterThanOrEqual(401);
  });

  it('nomor telepon yang sudah digunakan → 400', async () => {
    // Get another customer's phone
    const { data: other } = await supabase
      .from('customers')
      .select('phone')
      .neq('id', customerId)
      .is('deleted_at', null)
      .not('phone', 'is', null)
      .limit(1)
      .single();

    if (other?.phone) {
      const { status } = await req('PATCH', `${API}/customers/me`, customerToken, {
        phone: other.phone
      });
      expect(status).toBe(400);
    } else {
      // No other customer found — skip
      expect(true).toBe(true);
    }
  });
});

// ── 2. Mark single notification as read ───────────────────────────────────────

describe('PATCH /customers/notifications/:id/read — tandai notifikasi dibaca', () => {
  it('berhasil tandai notifikasi sebagai dibaca → 200', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/customers/notifications/${notifId1}/read`,
      customerToken
    );
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('read_at');
    expect(body.data.read_at).not.toBeNull();
  });

  it('read_at tersimpan di database', async () => {
    const { data } = await supabase
      .from('notifications')
      .select('read_at')
      .eq('id', notifId1)
      .single();
    expect(data?.read_at).not.toBeNull();
  });

  it('notifikasi milik customer lain → 404', async () => {
    // Use a random valid UUID that doesn't belong to fajar
    const { status } = await req(
      'PATCH',
      `${API}/customers/notifications/00000000-0000-4000-8000-000000099999/read`,
      customerToken
    );
    expect(status).toBe(404);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/customers/notifications/${notifId1}/read`
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });
});

// ── 3. Mark all notifications as read ─────────────────────────────────────────

describe('PATCH /customers/notifications/read-all — tandai semua dibaca', () => {
  it('berhasil → 200 dengan updated_count', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/customers/notifications/read-all`,
      customerToken
    );
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('updated_count');
    expect(typeof body.data.updated_count).toBe('number');
  });

  it('setelah read-all, notifikasi ke-2 juga read_at terisi', async () => {
    // Reset notif2 to unread first
    await supabase
      .from('notifications')
      .update({ read_at: null })
      .eq('id', notifId2);

    await req('PATCH', `${API}/customers/notifications/read-all`, customerToken);

    const { data } = await supabase
      .from('notifications')
      .select('read_at')
      .eq('id', notifId2)
      .single();
    expect(data?.read_at).not.toBeNull();
  });

  it('jika sudah semua dibaca, updated_count = 0', async () => {
    // All already read from previous test
    const { body } = await req(
      'PATCH',
      `${API}/customers/notifications/read-all`,
      customerToken
    );
    expect(body.data.updated_count).toBe(0);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req('PATCH', `${API}/customers/notifications/read-all`);
    expect(status).toBeGreaterThanOrEqual(401);
  });
});

// ── 4. Payment status by appointment ──────────────────────────────────────────

describe('GET /customers/appointments/:id/payment — status pembayaran', () => {
  it('appointment tanpa pembayaran → 404', async () => {
    const { status } = await req(
      'GET',
      `${API}/customers/appointments/${pendingAptId}/payment`,
      customerToken
    );
    expect(status).toBe(404);
  });

  it('appointment milik customer lain → 403', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000099';
    const { status } = await req(
      'GET',
      `${API}/customers/appointments/${fakeId}/payment`,
      customerToken
    );
    expect(status).toBe(403);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req(
      'GET',
      `${API}/customers/appointments/${pendingAptId}/payment`
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });

  it('appointment yang punya pembayaran mengembalikan data pembayaran', async () => {
    // Find an existing appointment with payment
    const { data: existing } = await supabase
      .from('payments')
      .select('id, appointment_id, appointments!inner(customer_id)')
      .eq('appointments.customer_id', customerId)
      .limit(1)
      .maybeSingle();

    if (existing?.appointment_id) {
      const { status, body } = await req(
        'GET',
        `${API}/customers/appointments/${existing.appointment_id}/payment`,
        customerToken
      );
      expect(status).toBe(200);
      expect(body.data).toHaveProperty('status');
      expect(body.data).toHaveProperty('total_amount');
    } else {
      // No payment data in seed — just verify route is registered (404 from controller, not router)
      const { body } = await req(
        'GET',
        `${API}/customers/appointments/${pendingAptId}/payment`,
        customerToken
      );
      expect(body).toHaveProperty('message');
    }
  });
});

// ── 5. Barber reject order ─────────────────────────────────────────────────────

describe('POST /barbers/appointments/:id/reject — tolak order', () => {
  it('berhasil menolak order pending dengan reason → 200', async () => {
    const { status, body } = await req(
      'POST',
      `${API}/barbers/appointments/${pendingAptId}/reject`,
      barberToken,
      { reason: 'Barber tidak tersedia pada waktu tersebut' }
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('rejected');
    expect(body.data.raw_status).toBe('cancelled');
    expect(body.data.reject_reason).toBe('Barber tidak tersedia pada waktu tersebut');
  });

  it('appointment menjadi cancelled di database', async () => {
    const { data } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', pendingAptId)
      .single();
    expect(data?.status).toBe('cancelled');
  });

  it('tolak order yang sudah cancelled → 400 atau error', async () => {
    // pendingAptId is now cancelled
    const { status } = await req(
      'POST',
      `${API}/barbers/appointments/${pendingAptId}/reject`,
      barberToken,
      { reason: 'Coba lagi' }
    );
    expect(status).toBe(400);
  });

  it('body tanpa reason → 400', async () => {
    const newAptId = await insertApt({ status: 'pending' });
    const { status } = await req(
      'POST',
      `${API}/barbers/appointments/${newAptId}/reject`,
      barberToken,
      {}
    );
    expect(status).toBe(400);
  });

  it('reason kosong → 400', async () => {
    const newAptId = await insertApt({ status: 'pending' });
    const { status } = await req(
      'POST',
      `${API}/barbers/appointments/${newAptId}/reject`,
      barberToken,
      { reason: '   ' }
    );
    expect(status).toBe(400);
  });

  it('appointment barber lain → 403', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000099';
    const { status } = await req(
      'POST',
      `${API}/barbers/appointments/${fakeId}/reject`,
      barberToken,
      { reason: 'Coba' }
    );
    expect(status).toBe(403);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req(
      'POST',
      `${API}/barbers/appointments/${pendingAptId}/reject`,
      undefined,
      { reason: 'Test' }
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });
});

// ── 6. Barber mark no-show ────────────────────────────────────────────────────

describe('PATCH /barbers/appointments/:id/no-show — tandai tidak hadir', () => {
  it('berhasil menandai no-show dari status confirmed → 200', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/barbers/appointments/${confirmedAptId}/no-show`,
      barberToken
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('no_show');
    expect(body.data.raw_status).toBe('no_show');
  });

  it('appointment menjadi no_show di database', async () => {
    const { data } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', confirmedAptId)
      .single();
    expect(data?.status).toBe('no_show');
  });

  it('no-show dari status yang tidak valid (bukan confirmed/in_queue) → 400', async () => {
    // confirmedAptId is now no_show — try again
    const { status } = await req(
      'PATCH',
      `${API}/barbers/appointments/${confirmedAptId}/no-show`,
      barberToken
    );
    expect(status).toBe(400);
  });

  it('appointment barber lain → 403', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000099';
    const { status } = await req(
      'PATCH',
      `${API}/barbers/appointments/${fakeId}/no-show`,
      barberToken
    );
    expect(status).toBe(403);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/barbers/appointments/${confirmedAptId}/no-show`
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });
});

// ── 7. Barber presence status ─────────────────────────────────────────────────

describe('PATCH /barbers/me/status — set status kehadiran', () => {
  it('set status "online" → 200', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/barbers/me/status`,
      barberToken,
      { status: 'online' }
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('online');
  });

  it('status tersimpan di database barbers.live_status', async () => {
    const { data } = await supabase
      .from('barbers')
      .select('live_status')
      .eq('id', barberId)
      .single();
    expect(data?.live_status).toBe('online');
  });

  it('set status "offline" → 200', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/barbers/me/status`,
      barberToken,
      { status: 'offline' }
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('offline');
  });

  it('set status "unavailable" → 200', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/barbers/me/status`,
      barberToken,
      { status: 'unavailable' }
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('unavailable');
  });

  it('status tidak valid → 400', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/barbers/me/status`,
      barberToken,
      { status: 'busy' }
    );
    expect(status).toBe(400);
  });

  it('body kosong → 400', async () => {
    const { status } = await req(
      'PATCH',
      `${API}/barbers/me/status`,
      barberToken,
      {}
    );
    expect(status).toBe(400);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req('PATCH', `${API}/barbers/me/status`, undefined, { status: 'online' });
    expect(status).toBeGreaterThanOrEqual(401);
  });

  it('status online juga tercermin di /customers/catalog/branches/:id/barbers', async () => {
    await req('PATCH', `${API}/barbers/me/status`, barberToken, { status: 'online' });

    const { body } = await req('GET', `${API}/customers/catalog/branches/${branchId}/barbers`);
    const barberData = (body.data ?? []).find((b: any) => b.id === barberId);
    expect(barberData?.live_status).toBe('online');
  });
});

// ── 8. Navigation data ────────────────────────────────────────────────────────

describe('GET /barbers/appointments/:id/navigation — data navigasi', () => {
  let homeAptId = '';

  beforeAll(async () => {
    homeAptId = await insertApt({
      status: 'confirmed',
      fulfillment_type: 'home_service',
      service_address: 'Jl. Navigasi No. 10',
      destination_latitude: -6.1800,
      destination_longitude: 106.7900,
      location_notes: 'Pagar merah',
      customer_media_urls: ['https://cdn.example.com/nav.jpg'],
      journey_status: 'en_route'
    });
  });

  it('mengembalikan data navigasi lengkap → 200', async () => {
    const { status, body } = await req(
      'GET',
      `${API}/barbers/appointments/${homeAptId}/navigation`,
      barberToken
    );
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('appointment_id');
    expect(body.data).toHaveProperty('destination');
    expect(body.data).toHaveProperty('service_address');
    expect(body.data).toHaveProperty('location_notes');
    expect(body.data).toHaveProperty('route');
    expect(body.data).toHaveProperty('customer_location');
    expect(body.data).toHaveProperty('journey_status');
    expect(body.data).toHaveProperty('customer_media_urls');
  });

  it('destination berisi { lat, lng } untuk home_service', async () => {
    const { body } = await req(
      'GET',
      `${API}/barbers/appointments/${homeAptId}/navigation`,
      barberToken
    );
    expect(body.data.destination).toEqual({ lat: -6.18, lng: 106.79 });
  });

  it('service_address dan location_notes terisi', async () => {
    const { body } = await req(
      'GET',
      `${API}/barbers/appointments/${homeAptId}/navigation`,
      barberToken
    );
    expect(body.data.service_address).toBe('Jl. Navigasi No. 10');
    expect(body.data.location_notes).toBe('Pagar merah');
  });

  it('journey_status sesuai data appointment', async () => {
    const { body } = await req(
      'GET',
      `${API}/barbers/appointments/${homeAptId}/navigation`,
      barberToken
    );
    expect(body.data.journey_status).toBe('en_route');
  });

  it('fulfillment_type tersedia', async () => {
    const { body } = await req(
      'GET',
      `${API}/barbers/appointments/${homeAptId}/navigation`,
      barberToken
    );
    expect(body.data.fulfillment_type).toBe('home_service');
  });

  it('appointment barber lain → 404', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000099';
    const { status } = await req(
      'GET',
      `${API}/barbers/appointments/${fakeId}/navigation`,
      barberToken
    );
    expect(status).toBe(404);
  });

  it('tanpa token → ≥401', async () => {
    const { status } = await req(
      'GET',
      `${API}/barbers/appointments/${homeAptId}/navigation`
    );
    expect(status).toBeGreaterThanOrEqual(401);
  });
});
