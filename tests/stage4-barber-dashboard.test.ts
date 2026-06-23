/**
 * Stage 4 — Barber queue & dashboard improvements
 *
 * Covers:
 *  1. Queue field completeness: fulfillment_type, service_address, destination_location,
 *     location_notes, customer_media_urls, journey_status
 *  2. ETA/route baca dari tracking:{id}:route (bukan legacy appointment:eta:*)
 *  3. Earnings naming: barber_share_including_tip, tip_amount, total_earnings tanpa double-count
 *  4. Pagination: riwayat appointment, stats harian, komisi, portfolio
 *  5. GET /barber/appointments/history — hanya terminal statuses
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import {
  getLegacyAppointmentEtaKey,
  getTrackingRouteKey,
  redis
} from '../src/lib/redis';
import { RealtimeTrackingService } from '../src/core/tracking/service';

const API = '/api/v1';
const PASS = 'password123';

let daviesToken = '';
let barberId = '';
let branchId = '';
let customerId = '';

// Test appointments
let homeServiceAptId = '';     // confirmed, home_service
let inStoreAptId = '';         // confirmed, in_store
let completedAptId = '';       // completed (for history)
let cancelledAptId = '';       // cancelled (for history)
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

const setTrackingRoute = async (appointmentId: string, route: object) => {
  await redis.setex(getTrackingRouteKey(appointmentId), 120, JSON.stringify(route));
};

const setLegacyEta = async (appointmentId: string, payload: object) => {
  await redis.setex(getLegacyAppointmentEtaKey(appointmentId), 120, JSON.stringify(payload));
};

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Login
  const loginRes = await req('POST', `${API}/barber/auth/login`, undefined, {
    email: 'davies@bombbarbershop.com',
    password: PASS
  });
  if (!loginRes.body?.data?.accessToken) throw new Error(`Login gagal: ${JSON.stringify(loginRes.body)}`);
  daviesToken = loginRes.body.data.accessToken;

  // Resolve IDs
  const { data: daviesStaff } = await supabase.from('staff_users').select('id').eq('email', 'davies@bombbarbershop.com').single();
  const { data: daviesBarber } = await supabase.from('barbers').select('id, branch_id').eq('staff_user_id', daviesStaff!.id).single();
  barberId = daviesBarber!.id;
  branchId = daviesBarber!.branch_id;

  const { data: customer } = await supabase.from('customers').select('id').eq('email', 'fajar.customer@example.com').single();
  customerId = customer!.id;

  // Create test appointments
  homeServiceAptId = await insertApt({
    status: 'confirmed',
    fulfillment_type: 'home_service',
    service_address: 'Jl. Merdeka No. 10, Jakarta Pusat',
    destination_latitude: -6.2442,
    destination_longitude: 106.8096,
    location_notes: 'Lantai 3, unit 301',
    customer_media_urls: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'],
    journey_status: 'en_route'
  });

  inStoreAptId = await insertApt({
    status: 'in_queue',
    fulfillment_type: 'in_store'
  });

  // Multiple completed appointments for history pagination tests
  for (let i = 0; i < 4; i++) {
    await insertApt({ status: 'completed' });
  }
  completedAptId = allAptIds[allAptIds.length - 1];

  cancelledAptId = await insertApt({ status: 'cancelled' });
});

afterAll(async () => {
  for (const id of allAptIds) {
    await RealtimeTrackingService.cleanup(id);
  }
  if (allAptIds.length) {
    await supabase.from('tracking_sessions').delete().in('appointment_id', allAptIds);
    await supabase.from('appointment_events').delete().in('appointment_id', allAptIds);
    await supabase.from('appointments').delete().in('id', allAptIds);
  }
});

// ── 1. Queue field completeness ───────────────────────────────────────────────

describe('GET /barber/queue — kelengkapan field Stage 4', () => {
  it('mengembalikan fulfillment_type untuk tiap item queue', async () => {
    const { status, body } = await req('GET', `${API}/barber/queue`, daviesToken);

    expect(status).toBe(200);
    const items: any[] = body.data ?? [];
    const homeItem = items.find((i: any) => i.id === homeServiceAptId);
    expect(homeItem).toBeDefined();
    expect(homeItem.fulfillment_type).toBe('home_service');
  });

  it('mengembalikan service_address untuk home_service', async () => {
    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);
    expect(homeItem?.service_address).toBe('Jl. Merdeka No. 10, Jakarta Pusat');
  });

  it('mengembalikan destination_location sebagai { lat, lng } untuk home_service', async () => {
    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);
    expect(homeItem?.destination_location).toEqual({ lat: -6.2442, lng: 106.8096 });
  });

  it('mengembalikan location_notes untuk home_service', async () => {
    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);
    expect(homeItem?.location_notes).toBe('Lantai 3, unit 301');
  });

  it('mengembalikan customer_media_urls sebagai array', async () => {
    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);
    expect(Array.isArray(homeItem?.customer_media_urls)).toBe(true);
    expect(homeItem?.customer_media_urls.length).toBe(2);
  });

  it('mengembalikan journey_status', async () => {
    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);
    expect(homeItem?.journey_status).toBe('en_route');
  });

  it('address queue home_service menggunakan service_address (bukan alamat branch/customer)', async () => {
    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);
    expect(homeItem?.address).toBe('Jl. Merdeka No. 10, Jakarta Pusat');
  });
});

// ── 2. ETA dari tracking route (bukan legacy key) ─────────────────────────────

describe('GET /barber/queue — ETA dari tracking route', () => {
  it('ETA mencerminkan nilai dari tracking:{id}:route ketika route tersedia', async () => {
    const route = {
      source: 'haversine_fallback',
      distance_km: 3.5,
      eta_minutes: 12,
      calculated_at: new Date().toISOString()
    };
    await setTrackingRoute(homeServiceAptId, route);

    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);

    expect(homeItem?.eta_minutes).toBe(12);
    expect(homeItem?.distance_km).toBe(3.5);
    expect(homeItem?.eta).toContain('12');
    expect(homeItem?.distance).toContain('3');

    await redis.del(getTrackingRouteKey(homeServiceAptId));
  });

  it('tidak membaca dari legacy key appointment:eta:* ketika tracking route tidak ada', async () => {
    // Hanya set legacy key, TIDAK set tracking route
    await setLegacyEta(homeServiceAptId, { eta_minutes: 99, distance_km: 99.9 });

    const { body } = await req('GET', `${API}/barber/queue`, daviesToken);
    const homeItem = (body.data ?? []).find((i: any) => i.id === homeServiceAptId);

    // Legacy key tidak boleh dibaca — ETA harus "Belum tersedia" atau fallback status
    expect(homeItem?.eta_minutes).toBeNull();
    expect(homeItem?.distance_km).toBeNull();
    expect(homeItem?.eta).not.toContain('99');

    await redis.del(getLegacyAppointmentEtaKey(homeServiceAptId));
  });
});

// ── 3. Earnings naming fix ────────────────────────────────────────────────────

describe('GET /barber/dashboard/today — earnings tidak ambigu', () => {
  it('menggunakan barber_share_including_tip (bukan commission_earned)', async () => {
    const { status, body } = await req('GET', `${API}/barber/dashboard/today`, daviesToken);

    expect(status).toBe(200);
    expect(body.data).toHaveProperty('barber_share_including_tip');
    // Field lama yang ambigu tidak boleh ada
    expect(body.data).not.toHaveProperty('commission_earned');
  });

  it('field tip_amount ada (bukan tips_earned)', async () => {
    const { body } = await req('GET', `${API}/barber/dashboard/today`, daviesToken);
    expect(body.data).toHaveProperty('tip_amount');
    expect(body.data).not.toHaveProperty('tips_earned');
  });

  it('total_earnings sama dengan barber_share_including_tip (tidak ada double-count)', async () => {
    const { body } = await req('GET', `${API}/barber/dashboard/today`, daviesToken);
    const d = body.data;
    // total_earnings = barber_share (sudah termasuk tip) — tidak ditambah tip_amount lagi
    expect(d.total_earnings).toBe(d.barber_share_including_tip);
  });
});

// ── 4. Pagination riwayat appointment ─────────────────────────────────────────

describe('GET /barber/appointments/history — riwayat dengan pagination', () => {
  it('hanya mengembalikan terminal status (completed, cancelled, no_show)', async () => {
    const { status, body } = await req('GET', `${API}/barber/appointments/history`, daviesToken);

    expect(status).toBe(200);
    const items: any[] = body.data ?? [];
    const activeFound = items.some((i: any) => ['pending', 'confirmed', 'in_queue', 'in_service'].includes(i.status));
    expect(activeFound).toBe(false);
  });

  it('mengembalikan pagination meta (page, limit, total, total_pages)', async () => {
    const { body } = await req('GET', `${API}/barber/appointments/history`, daviesToken);
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('limit');
    expect(body.meta).toHaveProperty('total');
    expect(body.meta).toHaveProperty('total_pages');
    expect(body.meta.page).toBe(1);
  });

  it('pagination limit membatasi jumlah item yang dikembalikan', async () => {
    const { body } = await req(
      'GET',
      `${API}/barber/appointments/history?page=1&limit=2`,
      daviesToken
    );

    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.meta.limit).toBe(2);
  });

  it('halaman berbeda mengembalikan item berbeda', async () => {
    const page1 = await req('GET', `${API}/barber/appointments/history?page=1&limit=2`, daviesToken);
    const page2 = await req('GET', `${API}/barber/appointments/history?page=2&limit=2`, daviesToken);

    const ids1: string[] = (page1.body.data ?? []).map((i: any) => i.id);
    const ids2: string[] = (page2.body.data ?? []).map((i: any) => i.id);

    // Halaman berbeda tidak boleh berisi ID yang sama (kecuali total <= limit)
    if (ids1.length > 0 && ids2.length > 0) {
      const overlap = ids1.filter((id) => ids2.includes(id));
      expect(overlap.length).toBe(0);
    }
  });

  it('menolak limit yang tidak valid', async () => {
    const { status } = await req('GET', `${API}/barber/appointments/history?limit=abc`, daviesToken);
    expect(status).toBe(400);
  });

  it('menolak page yang tidak valid', async () => {
    const { status } = await req('GET', `${API}/barber/appointments/history?page=0`, daviesToken);
    expect(status).toBe(400);
  });

  it('item riwayat mengandung field penting (id, status, fulfillment_type, price)', async () => {
    const { body } = await req('GET', `${API}/barber/appointments/history?limit=1`, daviesToken);
    const item = (body.data ?? [])[0];
    if (item) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('fulfillment_type');
      expect(item).toHaveProperty('price');
      expect(item).toHaveProperty('customer_name');
    }
  });
});

// ── 5. Pagination stats harian ────────────────────────────────────────────────

describe('GET /barber/stats/daily — pagination statistik harian', () => {
  it('mengembalikan pagination meta', async () => {
    const { status, body } = await req('GET', `${API}/barber/stats/daily`, daviesToken);

    expect(status).toBe(200);
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('limit');
    expect(body.meta).toHaveProperty('total');
    expect(body.meta.page).toBe(1);
  });

  it('limit query param membatasi jumlah baris', async () => {
    const { body } = await req('GET', `${API}/barber/stats/daily?limit=5`, daviesToken);
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.meta.limit).toBe(5);
  });

  it('stats row menyertakan alias barber_share_including_tip', async () => {
    const { body } = await req('GET', `${API}/barber/stats/daily?limit=1`, daviesToken);
    const row = (body.data ?? [])[0];
    if (row) {
      expect(row).toHaveProperty('barber_share_including_tip');
      // Nilai alias sama dengan commission_earned asli dari DB
      expect(row.barber_share_including_tip).toBe(row.commission_earned);
    }
  });

  it('menolak limit tidak valid (< 1)', async () => {
    const { status } = await req('GET', `${API}/barber/stats/daily?limit=0`, daviesToken);
    expect(status).toBe(400);
  });
});

// ── 6. Pagination komisi ──────────────────────────────────────────────────────

describe('GET /barber/commissions — pagination komisi', () => {
  it('mengembalikan pagination meta', async () => {
    const { status, body } = await req('GET', `${API}/barber/commissions`, daviesToken);

    expect(status).toBe(200);
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('limit');
    expect(body.meta).toHaveProperty('total');
    expect(body.meta.page).toBe(1);
  });

  it('limit query param membatasi jumlah baris', async () => {
    const { body } = await req('GET', `${API}/barber/commissions?limit=3`, daviesToken);
    expect(body.data.length).toBeLessThanOrEqual(3);
    expect(body.meta.limit).toBe(3);
  });

  it('komisi row menyertakan alias barber_share_including_tip', async () => {
    const { body } = await req('GET', `${API}/barber/commissions?limit=1`, daviesToken);
    const row = (body.data ?? [])[0];
    if (row) {
      expect(row).toHaveProperty('barber_share_including_tip');
      expect(row.barber_share_including_tip).toBe(row.commission_earned);
    }
  });

  it('menolak page tidak valid', async () => {
    const { status } = await req('GET', `${API}/barber/commissions?page=-1`, daviesToken);
    expect(status).toBe(400);
  });
});

// ── 7. Pagination portfolio ───────────────────────────────────────────────────

describe('GET /barber/portfolio — pagination portfolio', () => {
  it('mengembalikan pagination meta', async () => {
    const { status, body } = await req('GET', `${API}/barber/portfolio`, daviesToken);

    expect(status).toBe(200);
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('limit');
    expect(body.meta).toHaveProperty('total');
    expect(body.meta.page).toBe(1);
  });

  it('data adalah array', async () => {
    const { body } = await req('GET', `${API}/barber/portfolio`, daviesToken);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('limit query param dihormati', async () => {
    const { body } = await req('GET', `${API}/barber/portfolio?limit=2`, daviesToken);
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.meta.limit).toBe(2);
  });

  it('menolak limit tidak valid', async () => {
    const { status } = await req('GET', `${API}/barber/portfolio?limit=xyz`, daviesToken);
    expect(status).toBe(400);
  });
});

// ── 8. Autentikasi endpoint baru ──────────────────────────────────────────────

describe('Autentikasi endpoint Stage 4', () => {
  it('GET /barber/appointments/history tanpa token → 401/403', async () => {
    const { status } = await req('GET', `${API}/barber/appointments/history`);
    expect(status).toBeGreaterThanOrEqual(401);
  });

  it('GET /barber/stats/daily tanpa token → 401/403', async () => {
    const { status } = await req('GET', `${API}/barber/stats/daily`);
    expect(status).toBeGreaterThanOrEqual(401);
  });
});
