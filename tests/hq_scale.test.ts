import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('HQ Scale & Analytics Module (Phase 3)', () => {
  let branchId = '';
  let customerId = '';
  let barberId = '';
  let customerToken = '';
  let hqToken = '';
  let pendingAptId = '';
  let supportsHomeService = false;

  const password = 'Password123!';

  beforeAll(async () => {
    const pwHash = await argon2.hash(password);
    const suffix = crypto.randomUUID().split('-')[0];
    const { error: homeServiceSchemaError } = await supabase
      .from('appointments')
      .select('fulfillment_type')
      .limit(1);
    supportsHomeService = !homeServiceSchemaError;

    const { data: region } = await supabase.from('regions').insert({ code: `HQ${suffix.slice(-4)}`, name: 'HQ Region' }).select('id').single();
    const { data: branch } = await supabase.from('branches').insert({
      name: 'HQ Branch',
      region_id: region?.id,
      latitude: -6.2308,
      longitude: 106.8021
    }).select('id').single();
    if (branch) branchId = branch.id;

    const { data: customer } = await supabase.from('customers').insert({ full_name: 'CHQ', email: `chq${suffix}@test.com`, phone: `777${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer) customerId = customer.id;

    const { data: hqStaff } = await supabase.from('staff_users').insert({ full_name: 'HQAdmin', email: `hq${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    // Beri HQ akses super_admin
    const { data: roleHQ } = await supabase.from('roles').select('id').eq('name', 'super_admin').single();
    if (roleHQ && hqStaff) {
      await supabase.from('staff_user_roles').insert({
        staff_user_id: hqStaff.id, role_id: roleHQ.id
      });
    }

    const { data: barberStaff } = await supabase.from('staff_users').insert({ full_name: 'BHQ', email: `bhq${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    const { data: barber } = await supabase.from('barbers').insert({ staff_user_id: barberStaff?.id, branch_id: branchId, display_name: 'HQ Barber' }).select('id').single();
    if (barber) barberId = barber.id;

    // Login HQ
    const loginHQ = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `hq${suffix}@test.com`, password })
    })).then(r => r.json());
    hqToken = loginHQ.data?.accessToken;

    // Login Customer
    const loginC = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `777${suffix}`, password })
    })).then(r => r.json());
    customerToken = loginC.data?.accessToken;

    const appointmentPayload: Record<string, unknown> = {
      branch_id: branchId,
      customer_id: customerId,
      barber_id: barberId,
      source: 'online_booking',
      status: 'confirmed'
    };
    if (supportsHomeService) {
      Object.assign(appointmentPayload, {
        fulfillment_type: 'home_service',
        service_address: 'Jl. Test HQ Tracking, Jakarta Selatan',
        destination_latitude: -6.2442,
        destination_longitude: 106.8096,
        location_notes: 'Data sementara untuk test tracking HQ.'
      });
    }

    const { data: aptP } = await supabase.from('appointments').insert({
      ...appointmentPayload
    }).select('id').single();
    if (aptP) pendingAptId = aptP.id;
  });

  afterAll(async () => {
    // Teardown
    await supabase.from('check_ins').delete().eq('appointment_id', pendingAptId);
    await supabase.from('tracking_sessions').delete().eq('appointment_id', pendingAptId);
    await supabase.from('appointments').delete().eq('id', pendingAptId);
  });

  describe('Tracking Feature', () => {
    it('1. Ditolak memulai tracking jika tidak ada consent', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${pendingAptId}/tracking/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ consent: false })
      }));
      expect(res.status).toBe(400);
    });

    it('2. Berhasil memulai tracking dengan consent', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${pendingAptId}/tracking/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ consent: true })
      }));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.data.status).toBe('active');
    });

    it('3. Lokasi customer disimpan di Redis dan tidak dapat menentukan ETA sendiri', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${pendingAptId}/tracking/location`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ eta_minutes: 999, lat: -6.2, lng: 106.8 })
      }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.customer_location.actor_type).toBe('customer');
      expect(body.data.route).toBeNull();
    });

    it('4. Customer check-in tercatat di DB', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${pendingAptId}/check-in`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ method: 'geofence', lat: -6.2310, lng: 106.8022 })
      }));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.data.method).toBe('geofence');
    });
  });

  describe('HQ Analytics & Export', () => {
    it('1. HQ dapat melihat konsolidasi cabang', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/analytics/branches`, {
        method: 'GET', headers: { 'Authorization': `Bearer ${hqToken}` }
      }));
      expect(res.status).toBe(200);
    });

    it('2. Export revenue mengembalikan format CSV', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/reports/revenue/export`, {
        method: 'GET', headers: { 'Authorization': `Bearer ${hqToken}` }
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      const text = await res.text();
      expect(text).toContain('Invoice ID,Appointment ID');
    });

    it('3. Export komisi mengembalikan format CSV', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/reports/commission/export`, {
        method: 'GET', headers: { 'Authorization': `Bearer ${hqToken}` }
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const text = await res.text();
      expect(text).toContain('Barber Name,Base Amount');
    });
  });
});
