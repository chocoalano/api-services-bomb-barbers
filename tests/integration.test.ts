import { describe, expect, it, beforeAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('End-to-End Transaction Loop & Unit Tests', () => {
  let hqId = '';
  let adminId = '';
  let barberId = '';
  let customerId = '';
  let branchId = '';
  let service1Id = '';
  let service2Id = '';
  let ruleId = '';

  let hqToken = '';
  let adminToken = '';
  let barberToken = '';
  let customerToken = '';

  let walkInAptId = '';
  let onlineAptId = '';

  let initialDashboardStats: any = null;

  beforeAll(async () => {
    const pwHash = await argon2.hash('Password123!');
    const suffix = crypto.randomUUID().split('-')[0];

    // Ensure Roles
    const getRole = async (name: string) => {
      let { data } = await supabase.from('roles').select('id').eq('name', name).single();
      if (!data) {
        const { data: ins } = await supabase.from('roles').insert({ name }).select('id').single();
        data = ins;
      }
      return data!.id;
    };
    const roleAdmin = await getRole('branch_admin');
    const roleHQ = await getRole('super_admin');
    const roleBarber = await getRole('barber');

    // 1. Setup Branch
    const { data: region } = await supabase.from('regions').insert({ code: `RT${suffix}`, name: 'Test Region' }).select('id').single();
    const { data: branch } = await supabase.from('branches').insert({ name: 'Integration Branch', region_id: region!.id }).select('id').single();
    branchId = branch!.id;
    await supabase.from('branch_operating_hours').insert(
      Array.from({ length: 7 }, (_, day) => ({
        branch_id: branchId,
        day_of_week: day,
        open_time: '00:00:00',
        close_time: '23:59:59'
      }))
    );

    // 2. Setup Super Admin
    const { data: hq } = await supabase.from('staff_users').insert({ full_name: 'HQ Int', email: `hq${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    hqId = hq!.id;
    await supabase.from('staff_user_roles').insert({ staff_user_id: hqId, role_id: roleHQ });

    // 3. Setup Admin Cabang
    const { data: admin } = await supabase.from('staff_users').insert({ full_name: 'Admin Int', email: `ad${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    adminId = admin!.id;
    await supabase.from('staff_user_roles').insert({ staff_user_id: adminId, role_id: roleAdmin, branch_id: branchId });

    // 4. Setup Barber
    const { data: barb } = await supabase.from('staff_users').insert({ full_name: 'Barber Int', email: `bb${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    await supabase.from('staff_user_roles').insert({ staff_user_id: barb!.id, role_id: roleBarber, branch_id: branchId });
    const { data: realB } = await supabase.from('barbers').insert({ staff_user_id: barb!.id, branch_id: branchId, display_name: 'Barber Int' }).select('id').single();
    barberId = realB!.id;

    // 5. Setup Customer
    const { data: cust } = await supabase.from('customers').insert({ full_name: 'Cust Int', email: `cs${suffix}@test.com`, phone: `081${suffix}`, password_hash: pwHash }).select('id').single();
    customerId = cust!.id;

    // 6. Setup 2 Services & 1 Branch Price
    const { data: s1 } = await supabase.from('services').insert({ name: 'Service Satu', default_duration_min: 1 }).select('id').single();
    service1Id = s1!.id;
    const { data: s2 } = await supabase.from('services').insert({ name: 'Service Dua', default_duration_min: 1 }).select('id').single();
    service2Id = s2!.id;

    await supabase.from('service_prices').insert({ service_id: service1Id, branch_id: branchId, price_amount: 50000, effective_from: new Date(Date.now() - 10000).toISOString() });
    await supabase.from('service_prices').insert({ service_id: service2Id, price_amount: 100000, effective_from: new Date(Date.now() - 10000).toISOString() }); // Global default for s2

    // 7. Setup 1 Barber Commission Rule (Priority 5)
    const { data: rule, error: ruleErr } = await supabase.from('commission_rules').insert({ scope: 'barber', scope_ref_id: barberId, barber_pct: 60, branch_pct: 30, hq_pct: 10, tip_to_barber: true, effective_from: new Date(Date.now() - 10000).toISOString() }).select('id').single();
    if (ruleErr) throw new Error('Rule insert failed: ' + ruleErr.message);
    ruleId = rule!.id;

    // Logins
    const login = async (email: string, isCust = false) => {
      const url = isCust ? '/customer/auth/login' : '/staff/auth/login';
      const bodyPayload = isCust ? { phone: email, password: 'Password123!' } : { email, password: 'Password123!' };
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload) }));
      const text = await res.text();
      try {
        const body = JSON.parse(text);
        if (!body.data) throw new Error('No data in login response: ' + text);
        return body.data.accessToken;
      } catch (e) {
        throw new Error(`Login failed for ${email}: ${text}`);
      }
    };
    hqToken = await login(`hq${suffix}@test.com`);
    adminToken = await login(`ad${suffix}@test.com`);
    barberToken = await login(`bb${suffix}@test.com`);
    customerToken = await login(`081${suffix}`, true);

    // Get Initial Dashboard state
    const dashRes = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branchId}/dashboard/today`, { headers: { 'Authorization': `Bearer ${adminToken}` } }));
    const dashBody = await dashRes.json();
    initialDashboardStats = dashBody.data;
  }, 30_000);

  describe('Integration Loop: Walk-In', () => {
    let invoiceNumber = '';
    let paymentId = '';

    it('1. Walk-in membuat appointment source walk_in dan menyimpan harga', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branchId}/walk-ins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
          'Idempotency-Key': `integration-walkin-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          customer_id: customerId,
          barber_id: barberId,
          service_ids: [service1Id]
        })
      }));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.data.source).toBe('walk_in');
      expect(body.data.queue_position).toBeGreaterThan(0);
      walkInAptId = body.data.id;

      // Cek snapshot harga
      const { data: svcs } = await supabase.from('appointment_services').select('*').eq('appointment_id', walkInAptId);
      expect(svcs![0].price_amount).toBe(50000);
    });

    it('2. Barber memulai service', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${walkInAptId}/start`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${barberToken}` }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe('in_service');
    });

    it('3. Barber menyelesaikan service', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${walkInAptId}/complete`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${barberToken}` }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe('completed');
    });

    it('4. Kasir memproses pembayaran (Invoice generated & Audit log tercatat)', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${walkInAptId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({
          method: 'cash',
          status: 'paid',
          product_amount: 0,
          discount_amount: 0,
          tip_amount: 10000
        })
      }));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.data.invoice_number).toContain('INV-');
      invoiceNumber = body.data.invoice_number;
      paymentId = body.data.id;
      
      // Tunggu BullMQ / Background Task
      await new Promise(r => setTimeout(r, 500));
      
      // Cek Audit Log
      const { data: audits } = await supabase.from('audit_logs').select('*').eq('entity_id', paymentId);
      expect(audits?.length).toBeGreaterThan(0);
      expect(audits![0].action).toBe('CREATE_PAYMENT');
    });

    it('5. Menghitung komisi via endpoint menghasilkan 1 komisi, menghitung dua kali mental (Idempotency)', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${walkInAptId}/calculate-commission`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.data.base_amount).toBe(50000); // service 1 branch price
      expect(body.data.tip_amount).toBe(10000);

      // Hitung dua kali
      const res2 = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${walkInAptId}/calculate-commission`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }));
      expect(res2.status).toBe(409); // Idempotency conflict
    });

    it('6. Dashboard berubah setelah transaksi Walk-In selesai', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branchId}/dashboard/today`, { headers: { 'Authorization': `Bearer ${adminToken}` } }));
      const body = await res.json();
      
      const newStats = body.data;
      expect(newStats.total_appointments).toBe(initialDashboardStats.total_appointments + 1);
      expect(newStats.revenue.total).toBe(initialDashboardStats.revenue.total + 60000); // 50k + 10k tip
      expect(newStats.shares.barber).toBe(initialDashboardStats.shares.barber + 40000); // 60% dari 50k = 30k + 10k tip
    });
  });

  describe('Integration Loop: Online Booking', () => {
    it('1. Online Booking masuk antrian', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerToken}`,
          'Idempotency-Key': `integration-online-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          branch_id: branchId,
          barber_id: barberId,
          service_ids: [service2Id],
          scheduled_at: new Date(Date.now() + 86400000).toISOString() // besok
        })
      }));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.data.source).toBe('online_booking');
      onlineAptId = body.data.id;
    });

    it('2. Barber mulai & selesaikan booking online', async () => {
      const acceptRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/accept`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${barberToken}` }
      }));
      expect(acceptRes.status).toBe(200);

      const startRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/start`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${barberToken}` }
      }));
      expect(startRes.status).toBe(200);

      const completeRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${onlineAptId}/complete`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${barberToken}` }
      }));
      expect(completeRes.status).toBe(200);
      
      const { data } = await supabase.from('appointments').select('status').eq('id', onlineAptId).single();
      expect(data?.status).toBe('completed');
    });

    it('3. Bayar dan otomatis komisi', async () => {
      await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${onlineAptId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ method: 'cash', status: 'paid', product_amount: 0, discount_amount: 0, tip_amount: 0 })
      }));
      
      await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${onlineAptId}/calculate-commission`, { method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` } }));

      // Cek Dashboard bertambah lagi
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branchId}/dashboard/today`, { headers: { 'Authorization': `Bearer ${adminToken}` } }));
      const body = await res.json();
      expect(body.data.booking_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Unit Test Isolations (API Logic Verification)', () => {
    it('1. Unit test price resolution: Cek snapshot harga', async () => {
      const { data: svcs } = await supabase.from('appointment_services').select('price_amount').eq('appointment_id', onlineAptId);
      expect(svcs![0].price_amount).toBe(100000); // default global price
    });

    it('2. Unit test commission rule resolution: Cek rule terekam', async () => {
      const { data: cEntries } = await supabase.from('commission_entries').select('commission_rule_id').eq('appointment_id', onlineAptId);
      expect(cEntries![0].commission_rule_id).toBe(ruleId);
    });

    it('3. Unit test commission split integer: Hitungan harus presisi pembulatan (Barber 60% dari 100k = 60k)', async () => {
      const { data: cEntries } = await supabase.from('commission_entries').select('*').eq('appointment_id', onlineAptId).single();
      expect(cEntries!.base_amount).toBe(100000);
      expect(cEntries!.barber_share).toBe(60000);
      expect(cEntries!.branch_share).toBe(30000);
      expect(cEntries!.hq_share).toBe(10000);
      expect(cEntries!.barber_share + cEntries!.branch_share + cEntries!.hq_share).toBe(cEntries!.base_amount + cEntries!.tip_amount);
    });

    it('4. Unit test RBAC branch scope: Admin Cabang 1 dilarang memanipulasi Cabang 2', async () => {
      const { data: branch2 } = await supabase.from('branches').select('id').neq('id', branchId).limit(1).single();
      if (branch2) {
        const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branch2.id}/dashboard/today`, { headers: { 'Authorization': `Bearer ${adminToken}` } }));
        expect(res.status).toBe(403);
      }
    });

    it('5. Unit test payment total calculation', async () => {
      const { data: pmt } = await supabase.from('payments').select('*').eq('appointment_id', walkInAptId).single();
      expect(pmt!.service_amount).toBe(50000);
      expect(pmt!.tip_amount).toBe(10000);
      expect(pmt!.total_amount).toBe(60000); // 50k + 10k
    });

    it('6. Unit test audit log creation', async () => {
      const { data: audits } = await supabase.from('audit_logs').select('*').limit(1);
      expect(audits!.length).toBeGreaterThan(0);
      expect(audits![0]).toHaveProperty('before');
      expect(audits![0]).toHaveProperty('after');
    });
  });
});
