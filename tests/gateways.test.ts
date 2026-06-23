import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Payment Gateways Module (Midtrans & Xendit)', () => {
  let branchId = '';
  let customerId = '';
  let adminStaffId = '';
  let serviceId = '';
  let aptMidtransId = '';
  let aptXenditId = '';
  let adminToken = '';

  const password = 'Password123!';

  beforeAll(async () => {
    const pwHash = await argon2.hash(password);
    const suffix = crypto.randomUUID().split('-')[0];

    const { data: region } = await supabase.from('regions').insert({ code: `RG${suffix.toString().slice(-4)}`, name: 'Gateway Region' }).select('id').single();
    const { data: branch } = await supabase.from('branches').insert({ name: 'Gateway Branch', region_id: region?.id }).select('id').single();
    if (branch) branchId = branch.id;

    const { data: customer } = await supabase.from('customers').insert({ full_name: 'CGateway', email: `cg${suffix}@test.com`, phone: `333${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer) customerId = customer.id;

    const { data: adminStaff } = await supabase.from('staff_users').insert({ full_name: 'AGateway', email: `ag${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    if (adminStaff) adminStaffId = adminStaff.id;

    let { data: role } = await supabase.from('roles').select('id').eq('name', 'super_admin').maybeSingle();
    if (!role) {
      const { data: insertedRole } = await supabase.from('roles').insert({ name: 'super_admin' }).select('id').single();
      role = insertedRole;
    }
    if (role && adminStaff) {
      await supabase.from('staff_user_roles').insert({ staff_user_id: adminStaff.id, role_id: role.id, branch_id: null });
    }

    const { data: svc } = await supabase.from('services').insert({ name: 'GateCut', default_duration_min: 30 }).select('id').single();
    if (svc) serviceId = svc.id;

    await supabase.from('service_prices').insert({ service_id: serviceId, branch_id: branchId, price_amount: 50000, effective_from: new Date(Date.now() - 10000).toISOString() });

    // Login Admin
    const loginA = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `ag${suffix}@test.com`, password })
    })).then(r => r.json());
    adminToken = loginA.data.accessToken;

    // Create 2 Appointments
    const { data: apt1 } = await supabase.from('appointments').insert({
      branch_id: branchId, customer_id: customerId, source: 'online_booking', status: 'pending'
    }).select('id').single();
    aptMidtransId = apt1?.id || '';

    const { data: apt2 } = await supabase.from('appointments').insert({
      branch_id: branchId, customer_id: customerId, source: 'online_booking', status: 'pending'
    }).select('id').single();
    aptXenditId = apt2?.id || '';

    await supabase.from('appointment_services').insert([
      { appointment_id: aptMidtransId, service_id: serviceId, price_amount: 50000, duration_min: 30 },
      { appointment_id: aptXenditId, service_id: serviceId, price_amount: 50000, duration_min: 30 }
    ]);
  });

  afterAll(async () => {
    // Teardown
    await supabase.from('audit_logs').delete().in('entity_id', [paymentMidtransId, paymentXenditId]);
    await supabase.from('invoices').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('payments').delete().in('appointment_id', [aptMidtransId, aptXenditId]);
    await supabase.from('appointment_services').delete().in('appointment_id', [aptMidtransId, aptXenditId]);
    await supabase.from('appointments').delete().in('id', [aptMidtransId, aptXenditId]);
  });

  let paymentMidtransId = '';
  let paymentXenditId = '';

  it('1. Membuat pembayaran QRIS Midtrans sukses mengembalikan payment_url', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${aptMidtransId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        method: 'qris',
        status: 'pending',
        provider: 'midtrans'
      })
    }));
    const body = await res.json();
    if (res.status !== 201) console.log('[GATEWAY TEST ERROR 1]', body);
    expect(res.status).toBe(201);
    expect(body.data.status).toBe('pending');
    expect(body.data.gateway_reference).toContain('MIDTRANS-');
    expect(body.data.payment_url).toContain('sandbox.midtrans.com');
    paymentMidtransId = body.data.id;
  });

  it('2. Simulasi Webhook Midtrans Sukses merubah status menjadi paid dan cetak invoice', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/webhooks/payments/midtrans`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'signature': 'test-signature-midtrans'
      },
      body: JSON.stringify({
        order_id: paymentMidtransId,
        status_code: '200',
        gross_amount: '50000'
      })
    }));
    
    expect(res.status).toBe(200);

    // Verifikasi DB
    const { data: dbPayment } = await supabase.from('payments').select('*, invoices(invoice_number)').eq('id', paymentMidtransId).single();
    expect(dbPayment?.status).toBe('paid');
    expect(dbPayment?.paid_at).toBeDefined();
    expect(dbPayment?.invoices.length).toBeGreaterThan(0);
  });

  it('2b. Webhook fixed URL Midtrans tetap diterima untuk payment yang sudah paid', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'signature': 'test-signature-midtrans'
      },
      body: JSON.stringify({
        provider: 'midtrans',
        order_id: paymentMidtransId,
        status_code: '200',
        gross_amount: '50000'
      })
    }));

    expect(res.status).toBe(200);
  });

  it('3. Membuat pembayaran Bank Transfer Xendit sukses mengembalikan payment_url', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${aptXenditId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        method: 'bank_transfer',
        status: 'pending',
        provider: 'xendit'
      })
    }));
    const body = await res.json();
    
    expect(res.status).toBe(201);
    expect(body.data.status).toBe('pending');
    expect(body.data.gateway_reference).toContain('XENDIT-');
    expect(body.data.payment_url).toContain('xendit.co');
    paymentXenditId = body.data.id;
  });

  it('4. Simulasi Webhook Xendit gagal karena signature invalid (HTTP 401)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/webhooks/payments/xendit`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-callback-token': 'wrong-signature'
      },
      body: JSON.stringify({
        external_id: paymentXenditId,
        status: 'PAID'
      })
    }));
    
    expect(res.status).toBe(401);

    // Verifikasi DB (Masih Pending)
    const { data: dbPayment } = await supabase.from('payments').select('status').eq('id', paymentXenditId).single();
    expect(dbPayment?.status).toBe('pending');
  });
});
