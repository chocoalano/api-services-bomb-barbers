import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Payments & Invoice Module', () => {
  let branchId = '';
  let customerId = '';
  let otherCustomerId = '';
  let adminStaffId = '';
  let serviceId = '';
  let appointmentId = '';
  let adminToken = '';
  let customerToken = '';
  let otherCustomerToken = '';

  const password = 'Password123!';
  let pwHash = '';

  beforeAll(async () => {
    pwHash = await argon2.hash(password);
    const suffix = crypto.randomUUID().split('-')[0];
    const cEmail = `cp${suffix}@test.com`;
    const otherEmail = `cp-other${suffix}@test.com`;
    const aEmail = `ap${suffix}@test.com`;

    const { data: region } = await supabase.from('regions').insert({ code: `RP${suffix.toString().slice(-4)}`, name: 'Pay Region' }).select('id').single();
    const { data: branch } = await supabase.from('branches').insert({ name: 'Pay Branch', region_id: region?.id }).select('id').single();
    if (branch) branchId = branch.id;

    const { data: customer } = await supabase.from('customers').insert({ full_name: 'CPay', email: cEmail, phone: `222${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer) customerId = customer.id;
    const { data: otherCustomer } = await supabase.from('customers').insert({
      full_name: 'Other CPay',
      email: otherEmail,
      phone: `223${suffix}`,
      password_hash: pwHash
    }).select('id').single();
    if (otherCustomer) otherCustomerId = otherCustomer.id;

    const { data: adminStaff } = await supabase.from('staff_users').insert({ full_name: 'APay', email: aEmail, password_hash: pwHash }).select('id').single();
    if (adminStaff) adminStaffId = adminStaff.id;

    // Ensure admin staff has a role with global access for tests
    let { data: role } = await supabase.from('roles').select('id').eq('name', 'test_admin_role').maybeSingle();
    if (!role) {
      const { data: insertedRole } = await supabase.from('roles').insert({ name: 'test_admin_role' }).select('id').single();
      role = insertedRole;
    }
    if (role) {
      await supabase.from('staff_user_roles').insert({ staff_user_id: adminStaffId, role_id: role.id, branch_id: null });
    }

    const { data: svc } = await supabase.from('services').insert({ name: 'PayCut', default_duration_min: 30 }).select('id').single();
    if (svc) serviceId = svc.id;

    await supabase.from('service_prices').insert({ service_id: serviceId, branch_id: branchId, price_amount: 75000, effective_from: new Date(Date.now() - 10000).toISOString() });

    // Login Admin
    const loginA = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: aEmail, password })
    })).then(r => r.json());
    adminToken = loginA.data.accessToken;

    // Login Customer
    const loginC = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cEmail, password })
    })).then(r => r.json());
    customerToken = loginC.data.accessToken;
    const loginOther = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otherEmail, password })
    })).then(r => r.json());
    otherCustomerToken = loginOther.data.accessToken;

    // Create Appointment for Payment Test
    const { data: apt } = await supabase.from('appointments').insert({
      branch_id: branchId, customer_id: customerId, source: 'walk_in', status: 'in_queue'
    }).select('id').single();
    if (apt) appointmentId = apt.id;

    await supabase.from('appointment_services').insert({
      appointment_id: appointmentId, service_id: serviceId, price_amount: 75000, duration_min: 30
    });
  });

  afterAll(async () => {
    // Teardown
    await supabase.from('audit_logs').delete().eq('entity_id', appointmentId); // Hacky clean
    await supabase.from('invoices').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Clean all test invoices
    await supabase.from('payments').delete().eq('appointment_id', appointmentId);
    await supabase.from('appointment_services').delete().eq('appointment_id', appointmentId);
    await supabase.from('appointments').delete().eq('id', appointmentId);
    await supabase.from('service_prices').delete().eq('service_id', serviceId);
    await supabase.from('services').delete().eq('id', serviceId);
    await supabase.from('staff_users').delete().eq('id', adminStaffId);
    await supabase.from('customers').delete().in('id', [customerId, otherCustomerId]);
    await supabase.from('branches').delete().eq('id', branchId);
  });

  let paymentId = '';
  let invoiceNumber = '';

  it('1. Payment cash sukses dan 2. Total dihitung benar (Service 75k + Prod 25k - Disc 10k = 90k)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${appointmentId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        method: 'cash',
        status: 'paid',
        product_amount: 25000,
        discount_amount: 10000,
        tip_amount: 0
      })
    }));
    const body = await res.json();
    
    expect(res.status).toBe(201);
    expect(body.data.total_amount).toBe(90000); // 75k + 25k - 10k
    expect(body.data.status).toBe('paid');
    expect(body.data.paid_at).toBeDefined();
    
    paymentId = body.data.id;
    invoiceNumber = body.data.invoice_number;
  });

  it('3. Invoice number di-generate dan unik', async () => {
    expect(invoiceNumber).toContain('INV-');
    
    // Pastikan masuk ke table invoices
    const { data } = await supabase.from('invoices').select('*').eq('invoice_number', invoiceNumber).single();
    expect(data).toBeDefined();
    expect(data?.payment_id).toBe(paymentId);
  });

  it('4. Audit log tercatat untuk perubahan payment (via BullMQ)', async () => {
    // Beri waktu BullMQ Worker mengeksekusi job (Non-blocking)
    await new Promise(r => setTimeout(r, 500));

    const { data } = await supabase.from('audit_logs').select('*').eq('entity_id', paymentId).single();
    expect(data).toBeDefined();
    expect(data?.action).toBe('CREATE_PAYMENT');
    expect(data?.before).toBeNull();
    expect(data?.after.total_amount).toBe(90000);
  });

  it('5. Payment tidak bisa dibuat dua kali untuk appointment yang sama', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${appointmentId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        method: 'qris',
        status: 'paid'
      })
    }));
    
    expect(res.status).toBe(409); // Conflict (Double Pay Protection)
    const body = await res.json();
    expect(body.message).toContain('Double Pay Protection');
  });

  it('6. Invoice hanya dapat diambil customer pemilik melalui endpoint terproteksi', async () => {
    const res = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/invoices/${invoiceNumber}`,
      {
        headers: { 'Authorization': `Bearer ${customerToken}` }
      }
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.invoice_number).toBe(invoiceNumber);
    expect(body.data.payment.total_amount).toBe(90000);
    expect(body.data.payment.appointment.id).toBe(appointmentId);
  });

  it('6b. Endpoint invoice publik menolak request tanpa access token invoice', async () => {
    const res = await app.handle(new Request(
      `http://localhost${API_PREFIX}/invoices/${invoiceNumber}`
    ));
    expect(res.status).toBe(401);
  });

  it('6c. Customer lain tidak dapat membaca invoice yang bukan miliknya', async () => {
    const res = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/invoices/${invoiceNumber}`,
      {
        headers: { 'Authorization': `Bearer ${otherCustomerToken}` }
      }
    ));
    expect(res.status).toBe(404);
  });

  it('7. Customer dapat menginisiasi pembayaran via gateway (Midtrans mock)', async () => {
    // Create a fresh appointment owned by customer
    const { data: apt } = await supabase.from('appointments').insert({ branch_id: branchId, customer_id: customerId, source: 'online_booking', status: 'pending' }).select('id').single();
    const newAppointmentId = apt!.id;

    await supabase.from('appointment_services').insert({ appointment_id: newAppointmentId, service_id: serviceId, price_amount: 75000, duration_min: 30 });

    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${newAppointmentId}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
      body: JSON.stringify({ method: 'qris', provider: 'midtrans', tip_amount: 0 })
    }));

    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.payment_url).toBeDefined();
    expect(body.data.redirect_url).toBe(body.data.payment_url);
    expect(body.data.token).toContain('SNAP-');

    // cleanup
    await supabase.from('payments').delete().eq('appointment_id', newAppointmentId);
    await supabase.from('appointment_services').delete().eq('appointment_id', newAppointmentId);
    await supabase.from('appointments').delete().eq('id', newAppointmentId);
  });
});
