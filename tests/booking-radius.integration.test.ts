import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as argon2 from 'argon2';
import { app } from '../src/app';
import { testDb } from '../src/lib/test-db';

const API_PREFIX = '/api/v1';
const EARTH_RADIUS_METER = 6_371_000;
const BASE = { lat: -6.260721, lng: 106.813911 };

const pointNorth = (point: typeof BASE, meters: number) => ({
  lat: point.lat + (meters / EARTH_RADIUS_METER) * (180 / Math.PI),
  lng: point.lng
});

const jakartaSlotIso = (daysAhead: number, hour = 10) => {
  const jakartaNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  jakartaNow.setUTCDate(jakartaNow.getUTCDate() + daysAhead);
  const year = jakartaNow.getUTCFullYear();
  const month = String(jakartaNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jakartaNow.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:00:00+07:00`;
};

const jsonRequest = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });

describe('Booking service radius integration', () => {
  const previousTolerance = process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER;
  const suffix = crypto.randomUUID().split('-')[0];
  const password = 'Password123!';
  let passwordHash = '';

  let regionId = '';
  let customerId = '';
  let customerToken = '';
  let serviceId = '';
  let closeBranchId = '';
  let nearBranchId = '';
  let boundaryBranchId = '';
  let outsideBranchId = '';
  let inactiveBranchId = '';
  let noCoordsBranchId = '';
  let closeBarberId = '';
  let boundaryBarberId = '';
  let branchIds: string[] = [];
  let barberIds: string[] = [];
  let staffIds: string[] = [];
  let appointmentIds: string[] = [];
  let paymentGuardAppointmentId = '';

  const catalogCustomer = pointNorth(BASE, 1000);
  const changedLocationOutsideCloseBranch = pointNorth(pointNorth(BASE, 950), 2505);

  const insertBranch = async (
    key: string,
    payload: Record<string, unknown>
  ) => {
    const { data, error } = await testDb
      .from('branches')
      .insert({
        name: `Radius ${key} ${suffix}`,
        region_id: regionId,
        is_active: true,
        ...payload
      })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error(`Gagal membuat branch ${key}`);
    branchIds.push(data.id);
    return data.id;
  };

  const insertBarber = async (
    branchId: string,
    key: string,
    serviceRadiusKm: number
  ) => {
    const { data: staff, error: staffError } = await testDb
      .from('staff_users')
      .insert({
        full_name: `Radius Staff ${key}`,
        email: `radius-${key}-${suffix}@test.com`,
        password_hash: passwordHash,
        is_active: true
      })
      .select('id')
      .single();
    if (staffError || !staff) throw staffError ?? new Error(`Gagal membuat staff ${key}`);
    staffIds.push(staff.id);

    const { data: barber, error: barberError } = await testDb
      .from('barbers')
      .insert({
        staff_user_id: staff.id,
        branch_id: branchId,
        display_name: `Radius Barber ${key}`,
        live_status: 'available',
        approval_status: 'approved',
        service_radius_km: serviceRadiusKm
      })
      .select('id')
      .single();
    if (barberError || !barber) throw barberError ?? new Error(`Gagal membuat barber ${key}`);
    barberIds.push(barber.id);
    return barber.id;
  };

  const createBooking = async (
    branchId: string,
    barberId: string,
    destination: typeof BASE,
    idempotencyKey: string,
    daysAhead: number,
    extraPayload: Record<string, unknown> = {}
  ) => {
    const res = await app.handle(
      jsonRequest(`${API_PREFIX}/customers/appointments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          branch_id: branchId,
          barber_id: barberId,
          service_ids: [serviceId],
          scheduled_at: jakartaSlotIso(daysAhead),
          fulfillment_type: 'home_service',
          service_address: 'Jl. Radius Test No. 1, Jakarta Selatan',
          destination_latitude: destination.lat,
          destination_longitude: destination.lng,
          location_notes: 'Integration radius test',
          ...extraPayload
        })
      })
    );
    const body = await res.json();
    if (res.status === 201 && body.data?.id) appointmentIds.push(body.data.id);
    return { res, body };
  };

  beforeAll(async () => {
    process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER = '0.5';
    passwordHash = await argon2.hash(password);

    const { data: region, error: regionError } = await testDb
      .from('regions')
      .insert({ code: `RR${suffix.slice(0, 4)}`, name: `Radius Region ${suffix}` })
      .select('id')
      .single();
    if (regionError || !region) throw regionError ?? new Error('Gagal membuat region');
    regionId = region.id;

    closeBranchId = await insertBranch('close', {
      latitude: pointNorth(BASE, 950).lat,
      longitude: pointNorth(BASE, 950).lng
    });
    nearBranchId = await insertBranch('near', {
      latitude: pointNorth(BASE, 400).lat,
      longitude: pointNorth(BASE, 400).lng
    });
    boundaryBranchId = await insertBranch('boundary', {
      latitude: BASE.lat,
      longitude: BASE.lng
    });
    outsideBranchId = await insertBranch('outside', {
      latitude: pointNorth(BASE, -200).lat,
      longitude: pointNorth(BASE, -200).lng
    });
    inactiveBranchId = await insertBranch('inactive', {
      latitude: catalogCustomer.lat,
      longitude: catalogCustomer.lng,
      is_active: false
    });
    noCoordsBranchId = await insertBranch('no-coords', {
      latitude: null,
      longitude: null
    });

    closeBarberId = await insertBarber(closeBranchId, 'close', 2);
    await insertBarber(nearBranchId, 'near', 2);
    boundaryBarberId = await insertBarber(boundaryBranchId, 'boundary', 1);
    await insertBarber(outsideBranchId, 'outside', 1);
    await insertBarber(inactiveBranchId, 'inactive', 2);
    await insertBarber(noCoordsBranchId, 'no-coords', 2);

    await testDb.from('branch_operating_hours').insert(
      branchIds.flatMap((branchId) =>
        Array.from({ length: 7 }, (_, day) => ({
          branch_id: branchId,
          day_of_week: day,
          open_time: '00:00:00',
          close_time: '23:59:59'
        }))
      )
    );

    const { data: customer, error: customerError } = await testDb
      .from('customers')
      .insert({
        full_name: `Radius Customer ${suffix}`,
        email: `radius-customer-${suffix}@test.com`,
        phone: `62877${suffix.slice(0, 8)}`,
        password_hash: passwordHash
      })
      .select('id')
      .single();
    if (customerError || !customer) throw customerError ?? new Error('Gagal membuat customer');
    customerId = customer.id;

    const { data: service, error: serviceError } = await testDb
      .from('services')
      .insert({ name: `Radius Cut ${suffix}`, default_duration_min: 30 })
      .select('id')
      .single();
    if (serviceError || !service) throw serviceError ?? new Error('Gagal membuat service');
    serviceId = service.id;

    await testDb.from('service_prices').insert({
      service_id: serviceId,
      price_amount: 75000,
      effective_from: new Date(Date.now() - 60_000).toISOString()
    });

    const loginRes = await app.handle(
      jsonRequest(`${API_PREFIX}/customer/auth/login`, {
        method: 'POST',
        body: JSON.stringify({
          email: `radius-customer-${suffix}@test.com`,
          password
        })
      })
    );
    const loginBody = await loginRes.json();
    if (!loginBody.data?.accessToken) {
      throw new Error(`Login customer gagal: ${JSON.stringify(loginBody)}`);
    }
    customerToken = loginBody.data.accessToken;
  });

  afterAll(async () => {
    if (previousTolerance === undefined) {
      delete process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER;
    } else {
      process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER = previousTolerance;
    }

    const allAppointmentIds = [
      ...appointmentIds,
      paymentGuardAppointmentId
    ].filter(Boolean);
    if (allAppointmentIds.length > 0) {
      const { data: payments } = await testDb
        .from('payments')
        .select('id')
        .in('appointment_id', allAppointmentIds);
      const paymentIds = (payments ?? []).map((payment: any) => payment.id);
      if (paymentIds.length > 0) {
        await testDb.from('invoices').delete().in('payment_id', paymentIds);
        await testDb.from('payments').delete().in('id', paymentIds);
      }
      await testDb.from('check_ins').delete().in('appointment_id', allAppointmentIds);
      await testDb.from('tracking_sessions').delete().in('appointment_id', allAppointmentIds);
      await testDb.from('appointment_services').delete().in('appointment_id', allAppointmentIds);
      await testDb.from('appointment_events').delete().in('appointment_id', allAppointmentIds);
      await testDb.from('appointments').delete().in('id', allAppointmentIds);
    }
    if (serviceId) {
      await testDb.from('service_prices').delete().eq('service_id', serviceId);
      await testDb.from('services').delete().eq('id', serviceId);
    }
    if (branchIds.length > 0) {
      await testDb.from('branch_operating_hours').delete().in('branch_id', branchIds);
    }
    if (barberIds.length > 0) {
      await testDb.from('barbers').delete().in('id', barberIds);
    }
    if (staffIds.length > 0) {
      await testDb.from('staff_users').delete().in('id', staffIds);
    }
    if (customerId) {
      await testDb.from('customers').delete().eq('id', customerId);
    }
    if (branchIds.length > 0) {
      await testDb.from('branches').delete().in('id', branchIds);
    }
    if (regionId) {
      await testDb.from('regions').delete().eq('id', regionId);
    }
  });

  it('returns only serviceable active branches, with metadata, sorted by nearest distance', async () => {
    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/catalog/branches?latitude=${catalogCustomer.lat}&longitude=${catalogCustomer.lng}`
      )
    );
    const body = await res.json();
    const ids = body.data.map((branch: any) => branch.id);

    expect(res.status).toBe(200);
    expect(ids).toContain(closeBranchId);
    expect(ids).toContain(nearBranchId);
    expect(ids).toContain(boundaryBranchId);
    expect(ids).not.toContain(outsideBranchId);
    expect(ids).not.toContain(inactiveBranchId);
    expect(ids).not.toContain(noCoordsBranchId);
    expect(ids.indexOf(closeBranchId)).toBeLessThan(ids.indexOf(nearBranchId));

    const closeBranch = body.data.find((branch: any) => branch.id === closeBranchId);
    expect(typeof closeBranch.distance_km).toBe('number');
    expect(typeof closeBranch.distance_meter).toBe('number');
    expect(closeBranch.service_radius_km).toBe(2);
    expect(closeBranch.service_radius_meter).toBe(2000);
    expect(closeBranch.is_within_service_radius).toBe(true);
  });

  it('keeps a branch visible when customer is exactly on the service radius boundary', async () => {
    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/catalog/branches?latitude=${catalogCustomer.lat}&longitude=${catalogCustomer.lng}`
      )
    );
    const body = await res.json();
    const boundaryBranch = body.data.find((branch: any) => branch.id === boundaryBranchId);

    expect(res.status).toBe(200);
    expect(boundaryBranch).toBeDefined();
    expect(boundaryBranch.is_within_service_radius).toBe(true);
    expect(boundaryBranch.distance_meter).toBeLessThanOrEqual(
      boundaryBranch.service_radius_meter + boundaryBranch.tolerance_meter
    );
  });

  it('creates a booking when the selected branch can serve the submitted location', async () => {
    const { res, body } = await createBooking(
      closeBranchId,
      closeBarberId,
      catalogCustomer,
      `radius-inside-${suffix}`,
      1
    );

    expect(res.status).toBe(201);
    expect(body.data.branch_id).toBe(closeBranchId);
    expect(body.data.status).toBe('pending');
  });

  it('creates a booking on the exact service radius boundary', async () => {
    const { res, body } = await createBooking(
      boundaryBranchId,
      boundaryBarberId,
      catalogCustomer,
      `radius-boundary-${suffix}`,
      2
    );

    expect(res.status).toBe(201);
    expect(body.data.branch_id).toBe(boundaryBranchId);
  });

  it('rejects stale or forged customer location before appointment/payment is created', async () => {
    const idempotencyKey = `radius-outside-${suffix}`;
    const { res, body } = await createBooking(
      closeBranchId,
      closeBarberId,
      changedLocationOutsideCloseBranch,
      idempotencyKey,
      3,
      {
        distance_km: 0,
        is_within_service_radius: true
      }
    );

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('CUSTOMER_OUTSIDE_BRANCH_SERVICE_RADIUS');
    expect(body.data.branch_id).toBe(closeBranchId);
    expect(body.data.distance_km).toBeGreaterThan(body.data.service_radius_km);

    const { data: createdAppointments } = await testDb
      .from('appointments')
      .select('id')
      .eq('idempotency_key', idempotencyKey);
    expect(createdAppointments ?? []).toHaveLength(0);
  });

  it('rejects a location only a few meters outside radius when tolerance is below that gap', async () => {
    const { res, body } = await createBooking(
      boundaryBranchId,
      boundaryBarberId,
      pointNorth(BASE, 1005),
      `radius-just-outside-${suffix}`,
      4
    );

    expect(res.status).toBe(400);
    expect(body.code).toBe('CUSTOMER_OUTSIDE_BRANCH_SERVICE_RADIUS');
  });

  it('rejects swapped latitude and longitude on booking submit', async () => {
    const { res } = await createBooking(
      closeBranchId,
      closeBarberId,
      { lat: 106.813911, lng: -6.260721 },
      `radius-invalid-location-${suffix}`,
      5
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('revalidates radius before creating payment', async () => {
    const { data: apt, error: aptError } = await testDb
      .from('appointments')
      .insert({
        branch_id: closeBranchId,
        barber_id: closeBarberId,
        customer_id: customerId,
        source: 'online_booking',
        status: 'pending',
        scheduled_at: jakartaSlotIso(6),
        fulfillment_type: 'home_service',
        service_address: 'Jl. Radius Payment Guard No. 1',
        destination_latitude: changedLocationOutsideCloseBranch.lat,
        destination_longitude: changedLocationOutsideCloseBranch.lng,
        travel_buffer_min: 15
      })
      .select('id')
      .single();
    if (aptError || !apt) throw aptError ?? new Error('Gagal membuat appointment payment guard');
    paymentGuardAppointmentId = apt.id;

    await testDb.from('appointment_services').insert({
      appointment_id: paymentGuardAppointmentId,
      service_id: serviceId,
      price_amount: 75000,
      duration_min: 30
    });

    const res = await app.handle(
      jsonRequest(`${API_PREFIX}/customers/appointments/${paymentGuardAppointmentId}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({ method: 'qris', provider: 'midtrans' })
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('CUSTOMER_OUTSIDE_BRANCH_SERVICE_RADIUS');

    const { data: payments } = await testDb
      .from('payments')
      .select('id')
      .eq('appointment_id', paymentGuardAppointmentId);
    expect(payments ?? []).toHaveLength(0);
  });
});
