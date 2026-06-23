/**
 * Stage 3 — Tracking hardening integration tests
 *
 * Covers:
 *  1. CUSTOMER_LOCATION_STATUSES narrowed (pending no longer accepted)
 *  2. GPS accuracy threshold (accuracy_m > 100m rejected)
 *  3. Monotonic captured_at enforcement
 *  4. Customer check-in: manual method blocked, GPS geofence validation, distance_m stored
 *  5. POST /tracking/revoke — success, terminal status rejection, wrong customer
 *  6. GET /barber/appointments/:id — barber detail endpoint, ownership enforcement
 *  7. GET /barber/appointments/:id/tracking — snapshot endpoint, ownership enforcement
 *  8. PATCH /barber/appointments/:id/arrive — GPS required for home_service, arrive geofence
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import { getTrackingCustomerKey, redis } from '../src/lib/redis';
import { RealtimeTrackingService } from '../src/core/tracking/service';

const API = '/api/v1';
const PASS = 'password123';

// Destination coordinates for home_service arrive tests
const DEST_LAT = -6.2442;
const DEST_LNG = 106.8096;

let customerToken = '';
let otherCustomerToken = '';
let budiToken = '';
let andiToken = '';

let customerId = '';
let barberId = '';
let branchId = '';
let branchLat = -6.2000;
let branchLng = 106.8167;

// Appointments created in beforeAll and shared across tests
let homeServiceAptId = '';   // confirmed + home_service + active session
let pendingHomeAptId = '';   // pending + home_service + active session (status narrowing test)
let completedAptId = '';     // completed (terminal state for revoke rejection)
let revokeAptId = '';        // confirmed + active session (revoke success test)
let barberDetailAptId = '';  // for GET /barber/appointments/:id
let checkInInsideAptId = ''; // confirmed, GPS check-in inside radius
let checkInOutsideAptId = ''; // confirmed, GPS check-in outside radius
let arriveHomeInsideAptId = '';  // confirmed home_service, arrive inside radius
let arriveHomeOutsideAptId = ''; // confirmed home_service, arrive outside radius
let arriveHomeNoGpsAptId = '';   // confirmed home_service, no GPS body
let arriveInStoreAptId = '';     // confirmed in_store, arrive without geofence

const allAptIds: string[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const login = async (path: string, email: string) => {
  const { body } = await req('POST', path, undefined, { email, password: PASS });
  if (!body?.data?.accessToken) throw new Error(`Login gagal (${email}): ${JSON.stringify(body)}`);
  return body.data.accessToken as string;
};

const insertApt = async (extra: Record<string, any>): Promise<string> => {
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
  if (error) throw new Error(`insertApt: ${error.message}`);
  allAptIds.push(data!.id);
  return data!.id;
};

const insertSession = async (appointmentId: string) => {
  const { error } = await supabase.from('tracking_sessions').insert({
    appointment_id: appointmentId,
    status: 'active',
    consent_given_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  if (error) throw new Error(`insertSession: ${error.message}`);
};

const homeServicePayload = () => ({
  fulfillment_type: 'home_service',
  service_address: 'Jl. Test Stage 3, Jakarta',
  destination_latitude: DEST_LAT,
  destination_longitude: DEST_LNG
});

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Login as all test actors
  customerToken = await login(`${API}/customer/auth/login`, 'fajar.customer@example.com');
  otherCustomerToken = await login(`${API}/customer/auth/login`, 'raka.customer@example.com');
  budiToken = await login(`${API}/barber/auth/login`, 'budi@bombbarbers.com');
  andiToken = await login(`${API}/barber/auth/login`, 'andi@bombbarbers.com');

  // Resolve IDs
  const { data: fajar } = await supabase
    .from('customers').select('id').eq('email', 'fajar.customer@example.com').single();
  customerId = fajar!.id;

  const { data: budiStaff } = await supabase
    .from('staff_users').select('id').eq('email', 'budi@bombbarbers.com').single();
  const { data: budiBarber } = await supabase
    .from('barbers').select('id, branch_id').eq('staff_user_id', budiStaff!.id).single();
  barberId = budiBarber!.id;
  branchId = budiBarber!.branch_id;

  // Ensure branch has coordinates so geofence validation is deterministic
  const { data: branch } = await supabase
    .from('branches').select('latitude, longitude').eq('id', branchId).single();
  if (branch?.latitude && branch?.longitude) {
    branchLat = Number(branch.latitude);
    branchLng = Number(branch.longitude);
  } else {
    await supabase
      .from('branches')
      .update({ latitude: branchLat, longitude: branchLng })
      .eq('id', branchId);
  }

  // Create shared test appointments
  homeServiceAptId = await insertApt({ status: 'confirmed', ...homeServicePayload() });
  await insertSession(homeServiceAptId);

  pendingHomeAptId = await insertApt({ status: 'pending', ...homeServicePayload() });
  await insertSession(pendingHomeAptId);

  completedAptId = await insertApt({ status: 'completed' });

  revokeAptId = await insertApt({ status: 'confirmed' });
  await insertSession(revokeAptId);

  barberDetailAptId = await insertApt({ status: 'confirmed' });

  checkInInsideAptId = await insertApt({ status: 'confirmed' });
  checkInOutsideAptId = await insertApt({ status: 'confirmed' });

  arriveHomeInsideAptId = await insertApt({ status: 'confirmed', ...homeServicePayload() });
  arriveHomeOutsideAptId = await insertApt({ status: 'confirmed', ...homeServicePayload() });
  arriveHomeNoGpsAptId = await insertApt({ status: 'confirmed', ...homeServicePayload() });
  arriveInStoreAptId = await insertApt({ status: 'confirmed', fulfillment_type: 'in_store' });

  // Clear any stale Redis location state for the location-push tests
  await redis.del(
    getTrackingCustomerKey(homeServiceAptId),
    getTrackingCustomerKey(pendingHomeAptId)
  );
});

afterAll(async () => {
  for (const id of allAptIds) {
    await RealtimeTrackingService.cleanup(id);
  }
  if (allAptIds.length) {
    await supabase.from('check_ins').delete().in('appointment_id', allAptIds);
    await supabase.from('tracking_sessions').delete().in('appointment_id', allAptIds);
    await supabase.from('appointment_events').delete().in('appointment_id', allAptIds);
    await supabase.from('appointments').delete().in('id', allAptIds);
  }
});

// ── 1. CUSTOMER_LOCATION_STATUSES narrowed ────────────────────────────────────

describe('Pembatasan status customer untuk location push', () => {
  it('menolak lokasi customer ketika status appointment adalah pending', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/customer/appointments/${pendingHomeAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, captured_at: new Date().toISOString() }
    );

    expect(status).toBe(400);
    // errors field contains the actual message when using createErrorResponse('Bad Request', msg)
    expect(body.errors ?? body.message ?? '').toContain('hanya dapat');
  });

  it('menerima lokasi customer ketika status adalah confirmed (home_service)', async () => {
    await redis.del(getTrackingCustomerKey(homeServiceAptId));

    const { status } = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, accuracy_m: 10, captured_at: new Date().toISOString() }
    );

    expect(status).toBe(200);
  });
});

// ── 2. Validasi akurasi GPS ───────────────────────────────────────────────────

describe('Validasi akurasi GPS (accuracy_m threshold)', () => {
  it('menolak lokasi dengan accuracy_m melebihi 100m', async () => {
    await redis.del(getTrackingCustomerKey(homeServiceAptId));

    const { status, body } = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, accuracy_m: 150, captured_at: new Date().toISOString() }
    );

    expect(status).toBe(400);
    expect(body.errors ?? body.message ?? '').toContain('terlalu rendah');
  });

  it('menerima lokasi dengan accuracy_m dalam batas (< 100m)', async () => {
    await redis.del(getTrackingCustomerKey(homeServiceAptId));

    const { status } = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, accuracy_m: 50, captured_at: new Date().toISOString() }
    );

    expect(status).toBe(200);
  });

  it('menerima lokasi tanpa accuracy_m (field opsional)', async () => {
    await redis.del(getTrackingCustomerKey(homeServiceAptId));

    const { status } = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, captured_at: new Date().toISOString() }
    );

    expect(status).toBe(200);
  });
});

// ── 3. Monotonic captured_at ──────────────────────────────────────────────────

describe('Monotonic timestamp lokasi (captured_at)', () => {
  it('menolak lokasi kedua dengan captured_at sama persis dengan sebelumnya', async () => {
    await redis.del(getTrackingCustomerKey(homeServiceAptId));
    const capturedAt = new Date().toISOString();

    const first = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, accuracy_m: 10, captured_at: capturedAt }
    );
    expect(first.status).toBe(200);

    // Kirim ulang dengan captured_at identik → harus ditolak
    const second = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2450, lng: 106.8100, accuracy_m: 10, captured_at: capturedAt }
    );

    expect(second.status).toBe(400);
    expect(second.body.errors ?? second.body.message ?? '').toContain('lebih baru');
  });

  it('menolak lokasi dengan captured_at lebih lama dari lokasi sebelumnya', async () => {
    await redis.del(getTrackingCustomerKey(homeServiceAptId));
    const now = Date.now();

    const first = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, accuracy_m: 10, captured_at: new Date(now).toISOString() }
    );
    expect(first.status).toBe(200);

    const second = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2450, lng: 106.8100, accuracy_m: 10, captured_at: new Date(now - 5000).toISOString() }
    );

    expect(second.status).toBe(400);
    expect(second.body.errors ?? second.body.message ?? '').toContain('lebih baru');
  });

  it('menerima lokasi berurutan dengan captured_at monoton meningkat', async () => {
    await redis.del(getTrackingCustomerKey(homeServiceAptId));
    const base = Date.now();

    const first = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2442, lng: 106.8096, accuracy_m: 10, captured_at: new Date(base).toISOString() }
    );
    expect(first.status).toBe(200);

    const second = await req(
      'PATCH',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/location`,
      customerToken,
      { lat: -6.2443, lng: 106.8097, accuracy_m: 10, captured_at: new Date(base + 1000).toISOString() }
    );
    expect(second.status).toBe(200);
  });
});

// ── 4. Geofence check-in customer ────────────────────────────────────────────

describe('Geofence check-in customer', () => {
  it('menolak check-in dengan metode manual oleh customer', async () => {
    const { status, body } = await req(
      'POST',
      `${API}/customer/appointments/${homeServiceAptId}/check-in`,
      customerToken,
      { method: 'manual' }
    );

    expect(status).toBe(400);
    expect(body.errors ?? body.message ?? '').toContain('manual hanya');
  });

  it('menolak check-in GPS di luar radius cabang (> 500m)', async () => {
    // 0.005 derajat lintang ≈ 555m — di luar radius 500m
    const outsideLat = branchLat + 0.005;

    const { status, body } = await req(
      'POST',
      `${API}/customer/appointments/${checkInOutsideAptId}/check-in`,
      customerToken,
      { method: 'gps', lat: outsideLat, lng: branchLng }
    );

    expect(status).toBe(400);
    expect(body.errors ?? body.message ?? '').toContain('terlalu jauh');
  });

  it('check-in GPS berhasil ketika dalam radius cabang', async () => {
    // Gunakan koordinat cabang persis → jarak 0m, selalu dalam radius
    const { status, body } = await req(
      'POST',
      `${API}/customer/appointments/${checkInInsideAptId}/check-in`,
      customerToken,
      { method: 'gps', lat: branchLat, lng: branchLng }
    );

    expect(status).toBe(201);
    expect(body.success).toBe(true);
  });

  it('menyimpan distance_m di tabel check_ins setelah GPS check-in berhasil', async () => {
    const { data: ci } = await supabase
      .from('check_ins')
      .select('method, distance_m, location_lat, location_lng')
      .eq('appointment_id', checkInInsideAptId)
      .single();

    expect(ci?.method).toBe('gps');
    expect(ci?.distance_m).not.toBeNull();
    // Koordinat adalah cabang itu sendiri → jarak sangat kecil
    expect(Number(ci?.distance_m)).toBeLessThan(10);
  });
});

// ── 5. POST /tracking/revoke ──────────────────────────────────────────────────

describe('POST /customer/appointments/:id/tracking/revoke', () => {
  it('customer berhasil mencabut tracking session aktif', async () => {
    const { status, body } = await req(
      'POST',
      `${API}/customer/appointments/${revokeAptId}/tracking/revoke`,
      customerToken
    );

    expect(status).toBe(200);
    expect(body.data?.revoked).toBe(true);
  });

  it('session diperbarui menjadi revoked di database setelah revoke berhasil', async () => {
    const { data: session } = await supabase
      .from('tracking_sessions')
      .select('status')
      .eq('appointment_id', revokeAptId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    expect(session?.status).toBe('revoked');
  });

  it('menolak revoke pada appointment dengan status completed', async () => {
    const { status, body } = await req(
      'POST',
      `${API}/customer/appointments/${completedAptId}/tracking/revoke`,
      customerToken
    );

    expect(status).toBe(400);
    expect(body.errors ?? body.message ?? '').toContain('tidak aktif');
  });

  it('menolak revoke oleh customer yang bukan pemilik appointment', async () => {
    // otherCustomerToken (raka) mencoba revoke appointment milik fajar
    const { status } = await req(
      'POST',
      `${API}/customer/appointments/${homeServiceAptId}/tracking/revoke`,
      otherCustomerToken
    );

    expect(status).toBe(400);
  });
});

// ── 6. GET /barber/appointments/:id ──────────────────────────────────────────

describe('GET /barber/appointments/:id', () => {
  it('barber melihat detail appointment miliknya', async () => {
    const { status, body } = await req(
      'GET',
      `${API}/barber/appointments/${barberDetailAptId}`,
      budiToken
    );

    expect(status).toBe(200);
    expect(body.data?.id).toBe(barberDetailAptId);
    expect(body.data?.barber_id).toBe(barberId);
    // Response menyertakan relasi branches dan customers
    expect(body.data).toHaveProperty('branches');
    expect(body.data).toHaveProperty('customers');
  });

  it('menolak permintaan barber lain yang tidak memiliki appointment tersebut', async () => {
    const { status } = await req(
      'GET',
      `${API}/barber/appointments/${barberDetailAptId}`,
      andiToken
    );

    expect(status).toBe(404);
  });

  it('menolak permintaan tanpa autentikasi', async () => {
    const { status } = await req('GET', `${API}/barber/appointments/${barberDetailAptId}`);
    expect(status).toBeGreaterThanOrEqual(401);
  });
});

// ── 7. GET /barber/appointments/:id/tracking ──────────────────────────────────

describe('GET /barber/appointments/:id/tracking', () => {
  it('barber mendapatkan tracking snapshot appointment miliknya', async () => {
    const { status, body } = await req(
      'GET',
      `${API}/barber/appointments/${homeServiceAptId}/tracking`,
      budiToken
    );

    expect(status).toBe(200);
    expect(body.data?.appointment_id).toBe(homeServiceAptId);
    expect(body.data).toHaveProperty('tracking_status');
    expect(body.data).toHaveProperty('session');
    expect(body.data).toHaveProperty('barber_location');
    expect(body.data).toHaveProperty('customer_location');
  });

  it('menolak barber lain yang tidak memiliki appointment tersebut', async () => {
    const { status } = await req(
      'GET',
      `${API}/barber/appointments/${homeServiceAptId}/tracking`,
      andiToken
    );

    expect(status).toBe(403);
  });
});

// ── 8. Geofence arrive barber (home_service) ──────────────────────────────────

describe('Geofence arrive barber (home_service)', () => {
  it('menolak arrive home_service tanpa koordinat GPS di body', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/barber/appointments/${arriveHomeNoGpsAptId}/arrive`,
      budiToken
      // tidak ada body
    );

    expect(status).toBe(400);
    expect(body.message ?? '').toContain('GPS wajib');
  });

  it('menolak arrive home_service ketika barber di luar radius destination (> 300m)', async () => {
    // 0.003 derajat lintang ≈ 333m dari DEST_LAT → di luar radius 300m
    const outsideLat = DEST_LAT + 0.003;

    const { status, body } = await req(
      'PATCH',
      `${API}/barber/appointments/${arriveHomeOutsideAptId}/arrive`,
      budiToken,
      { lat: outsideLat, lng: DEST_LNG }
    );

    expect(status).toBe(400);
    expect(body.message ?? '').toContain('radius lokasi customer');
  });

  it('menerima arrive home_service ketika barber dalam radius destination', async () => {
    // Gunakan koordinat destination persis → jarak 0m
    const { status, body } = await req(
      'PATCH',
      `${API}/barber/appointments/${arriveHomeInsideAptId}/arrive`,
      budiToken,
      { lat: DEST_LAT, lng: DEST_LNG }
    );

    expect(status).toBe(200);
    expect(body.data?.status).toBe('arrived');
    expect(body.data?.raw_status).toBe('in_queue');
  });

  it('menerima arrive in_store tanpa GPS (tidak ada geofence)', async () => {
    const { status, body } = await req(
      'PATCH',
      `${API}/barber/appointments/${arriveInStoreAptId}/arrive`,
      budiToken
      // tidak ada body, in_store tidak memerlukan GPS
    );

    expect(status).toBe(200);
    expect(body.data?.raw_status).toBe('in_queue');
  });
});
