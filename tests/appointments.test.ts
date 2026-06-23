import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import { appointmentQueue } from '../src/lib/queue';
import {
  getTrackingBarberKey,
  getTrackingCustomerKey,
  getTrackingRouteKey,
  getTrackingSessionKey,
  redis
} from '../src/lib/redis';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Appointments & Queue Module', () => {
  let regionId = '';
  let branchId = '';
  let customerId = '';
  let barberStaffId = '';
  let barberId = '';
  let serviceId = '';

  let customerToken = '';
  let barberToken = '';

  let onlineAptId = '';
  let walkInAptId = '';
  let supportsHomeService = false;

  const password = 'Password123!';
  let pwHash = '';

  beforeAll(async () => {
    pwHash = await argon2.hash(password);
    const { error: homeServiceSchemaError } = await supabase
      .from('appointments')
      .select('fulfillment_type')
      .limit(1);
    supportsHomeService = !homeServiceSchemaError;

    // 1. Create Data (Using unique emails/phones)
    const suffix = Date.now();
    const cEmail = `c${suffix}@test.com`;
    const cPhone = `111${suffix}`;
    const bEmail = `b${suffix}@test.com`;

    const { data: region, error: e1 } = await supabase.from('regions').insert({ code: `A${suffix.toString().slice(-4)}`, name: 'Apt Region' }).select('id').single();
    if (e1) console.error('Region err:', e1);
    if (region) regionId = region.id;

    const { data: branch, error: e2 } = await supabase.from('branches').insert({
      name: 'Apt Branch',
      region_id: regionId,
      latitude: -6.260721,
      longitude: 106.813911
    }).select('id').single();
    if (e2) console.error('Branch err:', e2);
    if (branch) branchId = branch.id;
    await supabase.from('branch_operating_hours').insert(
      Array.from({ length: 7 }, (_, day) => ({
        branch_id: branchId,
        day_of_week: day,
        open_time: '00:00:00',
        close_time: '23:59:59'
      }))
    );

    const { data: customer, error: e3 } = await supabase.from('customers').insert({ full_name: 'C', email: cEmail, phone: cPhone, password_hash: pwHash }).select('id').single();
    if (e3) console.error('Customer err:', e3);
    if (customer) customerId = customer.id;

    const { data: barberStaff, error: e4 } = await supabase.from('staff_users').insert({ full_name: 'B', email: bEmail, password_hash: pwHash }).select('id').single();
    if (e4) console.error('Staff err:', e4);
    if (barberStaff) barberStaffId = barberStaff.id;

    const { data: barberRec, error: e5 } = await supabase.from('barbers').insert({ staff_user_id: barberStaffId, branch_id: branchId, display_name: 'Barber B' }).select('id').single();
    if (e5) console.error('Barber err:', e5);
    if (barberRec) barberId = barberRec.id;

    const { data: svc, error: e6 } = await supabase.from('services').insert({ name: 'Cut', default_duration_min: 30 }).select('id').single();
    if (e6) console.error('Service err:', e6);
    if (svc) serviceId = svc.id;

    const now = new Date();
    const past = new Date(now.getTime() - 100000).toISOString();
    await supabase.from('service_prices').insert({ service_id: serviceId, branch_id: branchId, price_amount: 50000, effective_from: past });

    // 2. Login
    const loginC = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cPhone, password })
    })).then(r => r.json());
    if(!loginC.data) console.error('LoginC err:', loginC);
    customerToken = loginC.data.accessToken;

    const loginB = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bEmail, password })
    })).then(r => r.json());
    if(!loginB.data) console.error('LoginB err:', loginB);
    barberToken = loginB.data.accessToken;
  });

  afterAll(async () => {
    // Delete service prices
    await supabase.from('service_prices').delete().eq('service_id', serviceId);
    
    // Delete appointments (cascade or manual)
    await supabase.from('check_ins').delete().in('appointment_id', [onlineAptId, walkInAptId].filter(Boolean));
    await supabase.from('tracking_sessions').delete().in('appointment_id', [onlineAptId, walkInAptId].filter(Boolean));
    await supabase.from('appointment_services').delete().in('appointment_id', [onlineAptId, walkInAptId].filter(Boolean));
    await supabase.from('appointment_events').delete().in('appointment_id', [onlineAptId, walkInAptId].filter(Boolean));
    await supabase.from('appointments').delete().in('id', [onlineAptId, walkInAptId].filter(Boolean));
    
    // Delete base data
    await supabase.from('services').delete().eq('id', serviceId);
    await supabase.from('barbers').delete().eq('id', barberId);
    await supabase.from('staff_users').delete().eq('id', barberStaffId);
    await supabase.from('customers').delete().eq('id', customerId);
    await supabase.from('branch_operating_hours').delete().eq('branch_id', branchId);
    await supabase.from('branches').delete().eq('id', branchId);
    await supabase.from('regions').delete().eq('id', regionId);
    await redis.del(`appointment:eta:${onlineAptId}`);
    await redis.del(`appointment:eta:${walkInAptId}`);
    for (const appointmentId of [onlineAptId, walkInAptId].filter(Boolean)) {
      await redis.del(
        getTrackingSessionKey(appointmentId),
        getTrackingCustomerKey(appointmentId),
        getTrackingBarberKey(appointmentId),
        getTrackingRouteKey(appointmentId)
      );
    }
  });

  it('1. Booking online membuat appointment source online_booking dan status pending', async () => {
    const bookingPayload: Record<string, unknown> = {
      branch_id: branchId,
      barber_id: barberId,
      service_ids: [serviceId],
      scheduled_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    };
    if (supportsHomeService) {
      Object.assign(bookingPayload, {
        fulfillment_type: 'home_service',
        service_address: 'Jl. Test Home Service No. 1, Jakarta Selatan',
        destination_latitude: -6.25,
        destination_longitude: 106.82,
        location_notes: 'Lokasi khusus test integrasi live tracking.'
      });
    }

    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${customerToken}`,
        'Idempotency-Key': `appointments-online-${Date.now()}`
      },
      body: JSON.stringify(bookingPayload)
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.source).toBe('online_booking');
    expect(body.data.status).toBe('pending');
    expect(body.data.queue_position).toBe(1); // First in queue

    onlineAptId = body.data.id;
  });

  it('1b. Customer tidak dapat mengubah status menjadi confirmed; barber yang menerima order', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${onlineAptId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
      body: JSON.stringify({ status: 'confirmed' })
    }));

    expect(res.status).toBe(400);

    const acceptRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/accept`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    const acceptBody = await acceptRes.json();
    expect(acceptRes.status).toBe(200);
    expect(acceptBody.data.raw_status).toBe('confirmed');
  });

  it('2. Walk-in membuat appointment source walk_in dan status in_queue', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branchId}/walk-ins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${barberToken}`,
        'x-branch-id': branchId,
        'Idempotency-Key': `appointments-walkin-${Date.now()}`
      },
      body: JSON.stringify({
        barber_id: barberId,
        service_ids: [serviceId],
        scheduled_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      })
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.source).toBe('walk_in');
    expect(body.data.status).toBe('in_queue');
    expect(body.data.queue_position).toBe(2); // Queue position increments

    walkInAptId = body.data.id;
  });

  it('3. Keduanya muncul di queue barber yang sama', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/queue`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    const confirmedOrder = body.data.find((item: any) => item.id === onlineAptId);
    expect(confirmedOrder.status).toBe('accepted');
    expect(confirmedOrder.raw_status).toBe('confirmed');

    const staffAliasRes = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/queue`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    const staffAliasBody = await staffAliasRes.json();
    const confirmedAliasOrder = staffAliasBody.data.find((item: any) => item.id === onlineAptId);
    expect(staffAliasRes.status).toBe(200);
    expect(confirmedAliasOrder.raw_status).toBe('confirmed');

    // Set online booking to 'in_queue' via admin patch.
    await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${onlineAptId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${barberToken}` },
      body: JSON.stringify({ status: 'in_queue' })
    }));

    const res2 = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/queue`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    const body2 = await res2.json();
    expect(body2.data.length).toBe(2);
  });

  it('3b. Customer dapat mengambil ongoing appointments dengan pagination dan relasi siap tampil', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments?status=waiting,in_process&limit=1&page=1`, {
      headers: { 'Authorization': `Bearer ${customerToken}` }
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(onlineAptId);
    expect(body.data[0].ongoing_status).toBe('waiting');
    expect(body.data[0].barber.full_name).toBe('Barber B');
    expect(body.data[0].services[0].name).toBe('Cut');
    expect(body.data[0].services[0].price).toBe(50000);
    expect(body.data[0].items[0].unit_price).toBe(50000);
    expect(body.data[0].location.lat).toBe(-6.260721);
    expect(body.data[0].barberLat).toBe(-6.260721);
  });

  it('3c. Customer dapat membaca ETA tracking dengan fallback lokasi cabang dan live Redis', async () => {
    const startRes = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${onlineAptId}/tracking/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
      body: JSON.stringify({ consent: true })
    }));
    expect(startRes.status).toBe(201);

    const initialRes = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${onlineAptId}/tracking/eta`, {
      headers: { 'Authorization': `Bearer ${customerToken}` }
    }));
    const initialBody = await initialRes.json();
    expect(initialRes.status).toBe(200);
    expect(initialBody.data.source).toBe('branch_fallback');
    expect(initialBody.data.location.lat).toBe(-6.260721);

    const updateRes = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${onlineAptId}/tracking/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
      body: JSON.stringify({ lat: -6.25, lng: 106.82 })
    }));
    expect(updateRes.status).toBe(200);

    const barberLocationRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/tracking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${barberToken}` },
      body: JSON.stringify({ lat: -6.260721, lng: 106.813911, speed_mps: 8 })
    }));
    expect(barberLocationRes.status).toBe(200);

    const liveRes = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${onlineAptId}/tracking/eta`, {
      headers: { 'Authorization': `Bearer ${customerToken}` }
    }));
    const liveBody = await liveRes.json();
    expect(liveRes.status).toBe(200);
    expect(liveBody.data.source).toBe('redis');
    expect(liveBody.data.eta_minutes).toBeGreaterThan(0);
    expect(liveBody.data.location.lat).toBe(-6.260721);
    expect(liveBody.data.customer_location.lat).toBe(-6.25);
  });

  it('3d. Redis live tracking dibersihkan saat appointment completed', async () => {
    const startServiceRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/start`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    expect(startServiceRes.status).toBe(200);

    const completeRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/complete`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    const completeBody = await completeRes.json();

    expect(completeRes.status).toBe(200);
    expect(completeBody.data.status).toBe('completed');

    const redisValue = await redis.get(`appointment:eta:${onlineAptId}`);
    expect(redisValue).toBeNull();

    const { data: trackingSession } = await supabase
      .from('tracking_sessions')
      .select('status')
      .eq('appointment_id', onlineAptId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(trackingSession?.status).toBe('completed');
  });

  it('4. Harga tersimpan sebagai snapshot', async () => {
    const { data } = await supabase.from('appointment_services').select('price_amount').eq('appointment_id', onlineAptId).single();
    expect(data?.price_amount).toBe(50000);
  });

  it('5. Perubahan service_prices tidak mengubah appointment_services lama', async () => {
    // Ubah harga service jadi 100k
    await supabase.from('service_prices').update({ price_amount: 100000 }).eq('service_id', serviceId);

    // Cek snapshot lama
    const { data } = await supabase.from('appointment_services').select('price_amount').eq('appointment_id', onlineAptId).single();
    expect(data?.price_amount).toBe(50000); // Harus tetap 50k
  });

  it('6. Appointment completed tidak dapat dimulai ulang oleh barber', async () => {
    const resStart = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/start`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    expect(resStart.status).toBe(400);
  });

  it('7. Redis status barber berubah jadi "serving" saat melayani dan "available" saat selesai (Walk-In Test)', async () => {
    // 1. Check initial (should be available)
    const getRes1 = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/barbers`));
    const body1 = await getRes1.json();
    const barberStatus1 = body1.data.find((b: any) => b.id === barberId);
    expect(barberStatus1.live_status).toBe('available');

    // 2. Barber Starts walk-in
    await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${walkInAptId}/start`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    
    // 3. Check status is 'serving'
    const getRes2 = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/barbers`));
    const body2 = await getRes2.json();
    const barberStatus2 = body2.data.find((b: any) => b.id === barberId);
    expect(barberStatus2.live_status).toBe('serving');

    // 4. Barber Completes walk-in
    await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${walkInAptId}/complete`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));

    // 5. Check status is 'available' again
    const getRes3 = await app.handle(new Request(`http://localhost${API_PREFIX}/branches/${branchId}/barbers`));
    const body3 = await getRes3.json();
    const barberStatus3 = body3.data.find((b: any) => b.id === barberId);
    expect(barberStatus3.live_status).toBe('available');
  });

  it('8. BullMQ menampung job Auto-Cancel Delay ke Redis secara background', async () => {
    const jobs = await appointmentQueue.getDelayed();
    expect(jobs.length).toBeGreaterThanOrEqual(2); // Karena kita insert 2 appointment
    
    const acceptanceJob = jobs.find(j => j.data.type === 'ORDER_ACCEPTANCE_TIMEOUT');
    const noShowJob = jobs.find(j => j.data.type === 'APPOINTMENT_NO_SHOW_TIMEOUT');
    expect(acceptanceJob).toBeDefined();
    expect(noShowJob).toBeDefined();

    // Clean up jobs
    await appointmentQueue.obliterate();
  });
});
