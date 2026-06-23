import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Audit Full Flow: 50/50 Commission Split', () => {
  let branchId = '';
  let customerId = '';
  let barberId = '';
  let adminToken = '';
  let customerToken = '';
  let serviceId = '';
  let ruleId = '';
  let appointmentId = '';
  let paymentId = '';

  const password = 'Password123!';
  const PRICE = 100000;

  beforeAll(async () => {
    const pwHash = await argon2.hash(password);
    const suffix = crypto.randomUUID().split('-')[0];

    // 1. Setup Branch & Region
    const { data: region } = await supabase.from('regions').insert({ code: `AUD${suffix}`, name: 'Audit Region' }).select('id').single();
    const { data: branch } = await supabase.from('branches').insert({ name: 'Audit Branch', region_id: region?.id }).select('id').single();
    if (branch) branchId = branch.id;
    await supabase.from('branch_operating_hours').insert(
      Array.from({ length: 7 }, (_, day) => ({
        branch_id: branchId,
        day_of_week: day,
        open_time: '00:00:00',
        close_time: '23:59:59'
      }))
    );

    // 2. Setup Customer
    const { data: customer } = await supabase.from('customers').insert({ full_name: 'Audit Cust', email: `ac${suffix}@test.com`, phone: `888${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer) customerId = customer.id;

    // 3. Setup Barber
    const { data: barberStaff } = await supabase.from('staff_users').insert({ full_name: 'Audit Barber', email: `ab${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    const { data: barber } = await supabase.from('barbers').insert({ staff_user_id: barberStaff?.id, branch_id: branchId, display_name: 'Audit Barber' }).select('id').single();
    if (barber) barberId = barber.id;

    // 4. Setup Admin
    const { data: adminStaff } = await supabase.from('staff_users').insert({ full_name: 'Audit Admin', email: `aa${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    const { data: roleAdmin } = await supabase.from('roles').select('id').eq('name', 'branch_admin').single();
    if (roleAdmin && adminStaff) {
      await supabase.from('staff_user_roles').insert({
        staff_user_id: adminStaff.id, role_id: roleAdmin.id, branch_id: branchId
      });
    }

    // 5. Setup Service
    const { data: srv, error: srvErr } = await supabase.from('services').insert({ name: 'Audit Haircut', description: '50/50 test', default_duration_min: 30 }).select('id').single();
    if (srvErr) throw new Error("Service Insert Error: " + srvErr.message);
    if (srv) {
      serviceId = srv.id;
      const { error: spErr } = await supabase.from('service_prices').insert({ branch_id: branchId, service_id: serviceId, price_amount: PRICE, effective_from: new Date(Date.now() - 86400000).toISOString() });
      if (spErr) throw new Error("Service Price Insert Error: " + spErr.message);
    }

    // 6. Setup 50/50 Commission Rule for this Barber
    const { data: rule, error: ruleErr } = await supabase.from('commission_rules').insert({
      scope: 'barber',
      scope_ref_id: barberId,
      barber_pct: 50,
      branch_pct: 50,
      hq_pct: 0,
      tip_to_barber: true,
      effective_from: new Date(Date.now() - 86400000).toISOString()
    }).select('id').single();
    if (ruleErr) throw new Error("Rule Insert Error: " + ruleErr.message);
    if (rule) ruleId = rule.id;

    // Login Admin & Customer
    const loginA = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `aa${suffix}@test.com`, password })
    })).then(r => r.json());
    adminToken = loginA.data?.accessToken;

    const loginC = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `888${suffix}`, password })
    })).then(r => r.json());
    customerToken = loginC.data?.accessToken;
  });

  it('1. Booking / Walk-in: Membuat Antrian Terpadu', async () => {
    // Simulasi Walk-in oleh Admin
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branchId}/walk-ins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
        'Idempotency-Key': `audit-walkin-${crypto.randomUUID()}`
      },
      body: JSON.stringify({ barber_id: barberId, customer_id: customerId, service_ids: [serviceId] })
    }));
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch(e) {
      throw new Error("Failed to parse Walk-in JSON: " + text);
    }
    if (res.status !== 201) console.log("Error Body:", body);
    expect(res.status).toBe(201);
    expect(body.data.source).toBe('walk_in');
    appointmentId = body.data.id;
  });

  it('2. Layanan: Memulai dan Menyelesaikan Servis', async () => {
    // Start
    const resStart = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${appointmentId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'in_service' })
    }));
    if (resStart.status !== 200) console.log("Start Error:", await resStart.text());
    expect(resStart.status).toBe(200);

    // Complete
    const resComplete = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${appointmentId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'completed' })
    }));
    if (resComplete.status !== 200) console.log("Complete Error:", await resComplete.text());
    expect(resComplete.status).toBe(200);
  });

  it('3. Pembayaran: Lunas dengan Invoice', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${appointmentId}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ method: 'cash', status: 'paid', amount_given: PRICE, tip_amount: 0 })
    }));
    const text = await res.text();
    let body = JSON.parse(text);
    if (res.status !== 201) console.log("Payment Error:", body);
    expect(res.status).toBe(201);
    expect(body.data.status).toBe('paid');
  });

  it('4. Hitung Komisi: Verifikasi 50% Cabang, 50% Barber', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${appointmentId}/calculate-commission`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` }
    }));
    const text = await res.text();
    const body = JSON.parse(text);
    if (res.status !== 201) console.log("Commission Error:", body);
    expect(res.status).toBe(201);
    
    const entry = body.data;
    expect(entry.base_amount).toBe(PRICE); // 100.000
    expect(entry.barber_share).toBe(PRICE * 0.5); // 50.000
    expect(entry.branch_share).toBe(PRICE * 0.5); // 50.000
    expect(entry.hq_share).toBe(0); // 0
  });
});
