import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { io as createClient, Socket } from 'socket.io-client';
import { app } from '../src/app';
import { io } from '../src/lib/socket';
import { supabase } from '../src/lib/supabase';
import {
  getTrackingBarberKey,
  getTrackingCustomerKey,
  getTrackingRouteKey,
  getTrackingSessionKey,
  getCustomerLocationKey,
  getLegacyAppointmentEtaKey,
  getTrackingRateLimitKey,
  redis
} from '../src/lib/redis';
import { RealtimeTrackingService } from '../src/core/tracking/service';

const socketPort = 47000 + Math.floor(Math.random() * 1000);
const socketUrl = `http://127.0.0.1:${socketPort}`;
const password = 'password123';

let appointmentId = '';
let noSessionAppointmentId = '';
let fajarCustomerId = '';
let customerToken = '';
let otherCustomerToken = '';
let barberToken = '';
let andiToken = '';
let hqToken = '';
let createdSessionId = '';
let noSessionCreatedId = '';
let socketStarted = false;
let supportsHomeService = false;
const sockets: Socket[] = [];

const login = async (path: string, body: Record<string, string>) => {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }));
  const payload = await response.json();
  if (response.status !== 200) {
    throw new Error(`Login test gagal: ${JSON.stringify(payload)}`);
  }
  return payload.data.accessToken as string;
};

const connect = (token: string) => new Promise<Socket>((resolve, reject) => {
  const socket = createClient(socketUrl, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    timeout: 5000
  });
  sockets.push(socket);
  socket.once('connect', () => resolve(socket));
  socket.once('connect_error', reject);
});

const emitWithAck = <T = any>(socket: Socket, event: string, payload: unknown) =>
  new Promise<T>((resolve) => {
    socket.timeout(5000).emit(event, payload, (_error: unknown, response: T) => {
      resolve(response);
    });
  });

beforeAll(async () => {
  const { error: homeServiceSchemaError } = await supabase
    .from('appointments')
    .select('fulfillment_type')
    .limit(1);
  supportsHomeService = !homeServiceSchemaError;

  customerToken = await login('/api/v1/customer/auth/login', {
    email: 'fajar.customer@example.com',
    password
  });
  otherCustomerToken = await login('/api/v1/customer/auth/login', {
    email: 'raka.customer@example.com',
    password
  });
  barberToken = await login('/api/v1/barber/auth/login', {
    email: 'budi@bombbarbers.com',
    password
  });
  andiToken = await login('/api/v1/barber/auth/login', {
    email: 'andi@bombbarbers.com',
    password
  });
  hqToken = await login('/api/v1/staff/auth/login', {
    email: 'hq@bombbarbers.com',
    password
  });

  const { data: fajar } = await supabase
    .from('customers')
    .select('id')
    .eq('email', 'fajar.customer@example.com')
    .single();
  fajarCustomerId = fajar!.id;

  const { data: budiStaff } = await supabase
    .from('staff_users')
    .select('id')
    .eq('email', 'budi@bombbarbers.com')
    .single();
  const { data: budi } = await supabase
    .from('barbers')
    .select('id, branch_id')
    .eq('staff_user_id', budiStaff!.id)
    .single();

  const appointmentPayload: Record<string, unknown> = {
    branch_id: budi!.branch_id,
    customer_id: fajar!.id,
    barber_id: budi!.id,
    source: 'online_booking',
    status: 'confirmed',
    scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    queue_position: 1,
    customer_media_urls: []
  };
  if (supportsHomeService) {
    Object.assign(appointmentPayload, {
      fulfillment_type: 'home_service',
      service_address: 'Jl. Test Realtime Security, Jakarta Selatan',
      destination_latitude: -6.2442,
      destination_longitude: 106.8096,
      location_notes: 'Data sementara untuk test Socket.IO.'
    });
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .insert(appointmentPayload)
    .select('id')
    .single();
  if (appointmentError) throw appointmentError;

  appointmentId = appointment!.id;
  const { data: activeSession } = await supabase
    .from('tracking_sessions')
    .select('id')
    .eq('appointment_id', appointmentId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (!activeSession) {
    const { data: session, error } = await supabase
      .from('tracking_sessions')
      .insert({
        appointment_id: appointmentId,
        status: 'active',
        consent_given_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      })
      .select('id')
      .single();
    if (error) throw error;
    createdSessionId = session.id;
  }

  await redis.del(
    getTrackingCustomerKey(appointmentId),
    getTrackingBarberKey(appointmentId),
    getTrackingRouteKey(appointmentId)
  );

  // Buat appointment tanpa tracking session untuk test penolakan consent.
  const noSessionPayload: Record<string, unknown> = {
    branch_id: budi!.branch_id,
    customer_id: fajar!.id,
    barber_id: budi!.id,
    source: 'online_booking',
    status: 'confirmed',
    scheduled_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    queue_position: 2,
    customer_media_urls: []
  };
  if (supportsHomeService) {
    Object.assign(noSessionPayload, {
      fulfillment_type: 'home_service',
      service_address: 'Jl. Test No-Session, Jakarta Selatan',
      destination_latitude: -6.2500,
      destination_longitude: 106.8100
    });
  }
  const { data: noSessionApt, error: noSessionError } = await supabase
    .from('appointments')
    .insert(noSessionPayload)
    .select('id')
    .single();
  if (noSessionError) throw noSessionError;
  noSessionAppointmentId = noSessionApt!.id;

  io.listen(socketPort);
  socketStarted = true;
});

afterAll(async () => {
  sockets.forEach((socket) => socket.disconnect());
  const allAppointmentIds = [appointmentId, noSessionAppointmentId].filter(Boolean);
  for (const id of allAppointmentIds) {
    await RealtimeTrackingService.cleanup(id);
  }
  if (createdSessionId) {
    await supabase.from('tracking_sessions').delete().eq('id', createdSessionId);
  }
  if (noSessionCreatedId) {
    await supabase.from('tracking_sessions').delete().eq('id', noSessionCreatedId);
  }
  if (allAppointmentIds.length) {
    await supabase.from('tracking_sessions').delete().in('appointment_id', allAppointmentIds);
    await supabase.from('appointments').delete().in('id', allAppointmentIds);
  }
  if (socketStarted) {
    await Promise.race([
      new Promise<void>((resolve) => io.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2000))
    ]);
  }
});

describe('Realtime customer-barber security', () => {
  it('menolak customer bergabung ke room appointment milik customer lain', async () => {
    const socket = await connect(otherCustomerToken);
    const response = await emitWithAck<any>(socket, 'join_appointment', appointmentId);

    expect(response.success).toBe(false);
    expect(response.error).toContain('ditolak');
  });

  it('mengizinkan participant resmi dan menghitung ETA server-side', async () => {
    const customerSocket = await connect(customerToken);
    const barberSocket = await connect(barberToken);

    expect((await emitWithAck<any>(
      customerSocket,
      'join_appointment',
      appointmentId
    )).success).toBe(true);
    expect((await emitWithAck<any>(
      barberSocket,
      'join_appointment',
      appointmentId
    )).success).toBe(true);

    const customerLocation = await emitWithAck<any>(
      customerSocket,
      'push_customer_location',
      {
        appointment_id: appointmentId,
        customer_location: {
          lat: -6.2442,
          lng: 106.8096,
          accuracy_m: 10,
          captured_at: new Date().toISOString(),
          eta_minutes: 999
        }
      }
    );
    expect(customerLocation.success).toBe(true);
    expect(customerLocation.data.customer_location.actor_type).toBe('customer');

    const eventPromise = new Promise<any>((resolve) => {
      customerSocket.once('appointment:barber_location', resolve);
    });
    const barberLocation = await emitWithAck<any>(
      barberSocket,
      'push_barber_location',
      {
        appointment_id: appointmentId,
        barber_location: {
          lat: -6.2607,
          lng: 106.8139,
          accuracy_m: 8,
          speed_mps: 8,
          captured_at: new Date().toISOString()
        }
      }
    );
    const realtimeEvent = await eventPromise;

    expect(barberLocation.success).toBe(true);
    expect(barberLocation.data.barber_location.actor_type).toBe('barber');
    expect(barberLocation.data.route.eta_minutes).toBeGreaterThan(0);
    expect(barberLocation.data.route.eta_minutes).not.toBe(999);
    expect(realtimeEvent.eta_minutes).toBe(barberLocation.data.route.eta_minutes);
    expect(realtimeEvent.barber_location.actor_type).toBe('barber');
    expect(realtimeEvent.route.eta_minutes).toBe(barberLocation.data.route.eta_minutes);
  }, 15000);
});

describe('Otorisasi room — penolakan peserta tidak sah', () => {
  it('menolak barber yang bergabung ke room appointment barber lain', async () => {
    const andiSocket = await connect(andiToken);
    const response = await emitWithAck<any>(andiSocket, 'join_appointment', appointmentId);

    expect(response.success).toBe(false);
    expect(response.error).toContain('ditolak');
  });

  it('menolak staff non-barber yang mencoba bergabung ke appointment', async () => {
    const hqSocket = await connect(hqToken);
    const response = await emitWithAck<any>(hqSocket, 'join_appointment', appointmentId);

    expect(response.success).toBe(false);
    expect(
      response.error.includes('barber') || response.error.includes('ditolak')
    ).toBe(true);
  });
});

describe('Validasi payload lokasi', () => {
  it('menolak push lokasi customer tanpa sesi tracking aktif', async () => {
    const socket = await connect(customerToken);
    await emitWithAck<any>(socket, 'join_appointment', noSessionAppointmentId);

    const response = await emitWithAck<any>(socket, 'push_customer_location', {
      appointment_id: noSessionAppointmentId,
      customer_location: {
        lat: -6.2442,
        lng: 106.8096,
        captured_at: new Date().toISOString()
      }
    });

    expect(response.success).toBe(false);
    expect(
      response.error.includes('tracking') ||
      response.error.includes('sesi') ||
      response.error.includes('session')
    ).toBe(true);
  });

  it('menolak koordinat di luar batas valid', async () => {
    const socket = await connect(customerToken);
    await emitWithAck<any>(socket, 'join_appointment', appointmentId);

    const response = await emitWithAck<any>(socket, 'push_customer_location', {
      appointment_id: appointmentId,
      customer_location: {
        lat: 200,
        lng: 200,
        captured_at: new Date().toISOString()
      }
    });

    expect(response.success).toBe(false);
    expect(response.error.toLowerCase()).toContain('latitude');
  });

  it('menolak lokasi dengan captured_at melebihi batas kedaluwarsa', async () => {
    const socket = await connect(customerToken);
    await emitWithAck<any>(socket, 'join_appointment', appointmentId);

    const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const response = await emitWithAck<any>(socket, 'push_customer_location', {
      appointment_id: appointmentId,
      customer_location: {
        lat: -6.2442,
        lng: 106.8096,
        captured_at: staleTime
      }
    });

    expect(response.success).toBe(false);
    expect(response.error.toLowerCase()).toContain('lama');
  });

  it('menolak lompatan koordinat yang tidak realistis secara fisik', async () => {
    const socket = await connect(customerToken);
    await emitWithAck<any>(socket, 'join_appointment', appointmentId);

    const now = Date.now();
    // Hapus lokasi sebelumnya agar baseline fresh dari push pertama.
    await redis.del(getTrackingCustomerKey(appointmentId));

    const first = await emitWithAck<any>(socket, 'push_customer_location', {
      appointment_id: appointmentId,
      customer_location: { lat: -6.2442, lng: 106.8096, captured_at: new Date(now).toISOString() }
    });
    expect(first.success).toBe(true);

    // Surabaya: ~700 km dari Jakarta, 1 detik kemudian → > 100 m/s.
    const second = await emitWithAck<any>(socket, 'push_customer_location', {
      appointment_id: appointmentId,
      customer_location: { lat: -7.2575, lng: 112.7521, captured_at: new Date(now + 1000).toISOString() }
    });

    expect(second.success).toBe(false);
    expect(second.error).toContain('realistis');
  }, 10000);

  it('rate limit lokasi customer bekerja', async () => {
    const socket = await connect(customerToken);
    await emitWithAck<any>(socket, 'join_appointment', appointmentId);

    // Reset counter rate limit untuk kombinasi actor+appointment ini.
    await redis.del(getTrackingRateLimitKey('customer', fajarCustomerId, appointmentId));
    // Reset lokasi agar jump check tidak memblokir sebelum rate limit.
    await redis.del(getTrackingCustomerKey(appointmentId));

    const now = Date.now();
    const baseLocation = { lat: -6.2442, lng: 106.8096 };

    // Kirim 11 push secara konkuren agar semua tiba dalam window 2 detik.
    // Socket.IO memproses event dari satu koneksi secara sekuensial di server,
    // sehingga koordinat yang sama tidak memicu jump check.
    const responses = await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        emitWithAck<any>(socket, 'push_customer_location', {
          appointment_id: appointmentId,
          customer_location: {
            ...baseLocation,
            captured_at: new Date(now + i * 100).toISOString()
          }
        })
      )
    );

    const rateLimitResponse = responses.find(
      (r) => !r.success && r.error.includes('banyak')
    );
    expect(rateLimitResponse).toBeDefined();
  }, 15000);
});

describe('Cleanup Redis tracking', () => {
  it('cleanup menghapus seluruh key tracking dari Redis', async () => {
    // Pastikan ada data di Redis untuk appointment ini sebelum cleanup.
    await redis.setex(getTrackingCustomerKey(appointmentId), 60, JSON.stringify({ test: true }));
    await redis.setex(getTrackingBarberKey(appointmentId), 60, JSON.stringify({ test: true }));
    await redis.setex(getTrackingRouteKey(appointmentId), 60, JSON.stringify({ test: true }));
    await redis.setex(getTrackingSessionKey(appointmentId), 60, JSON.stringify({ test: true }));
    await redis.setex(getCustomerLocationKey(appointmentId), 60, JSON.stringify({ test: true }));
    await redis.setex(getLegacyAppointmentEtaKey(appointmentId), 60, JSON.stringify({ test: true }));

    await RealtimeTrackingService.cleanup(appointmentId);

    const results = await Promise.all([
      redis.get(getTrackingCustomerKey(appointmentId)),
      redis.get(getTrackingBarberKey(appointmentId)),
      redis.get(getTrackingRouteKey(appointmentId)),
      redis.get(getTrackingSessionKey(appointmentId)),
      redis.get(getCustomerLocationKey(appointmentId)),
      redis.get(getLegacyAppointmentEtaKey(appointmentId))
    ]);

    expect(results.every((v) => v === null)).toBe(true);
  });
});
