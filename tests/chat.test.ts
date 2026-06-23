import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Live Chat API', () => {
  let regionId = '';
  let branchId = '';
  let customerId = '';
  let barberStaffId = '';
  let barberId = '';
  let serviceId = '';
  let customerToken = '';
  let barberToken = '';
  let appointmentId = '';

  beforeAll(async () => {
    const password = 'Password123!';
    const pwHash = await argon2.hash(password);
    const suffix = Date.now();

    const { data: region } = await supabase.from('regions').insert({ code: `C${suffix}`, name: 'Chat Region' }).select('id').single();
    regionId = region?.id || '';

    const { data: branch } = await supabase.from('branches').insert({ name: 'Chat Branch', region_id: regionId, latitude: -6.2, longitude: 106.8 }).select('id').single();
    branchId = branch?.id || '';

    const { data: customer } = await supabase.from('customers').insert({ full_name: 'Chat Customer', email: `cust${suffix}@test.com`, phone: `0812${suffix}`, password_hash: pwHash }).select('id').single();
    customerId = customer?.id || '';

    const { data: barberStaff } = await supabase.from('staff_users').insert({ full_name: 'Chat Barber', email: `barber${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    barberStaffId = barberStaff?.id || '';

    const { data: barber } = await supabase.from('barbers').insert({ staff_user_id: barberStaffId, branch_id: branchId, display_name: 'Chat Barber' }).select('id').single();
    barberId = barber?.id || '';

    const { data: svc } = await supabase.from('services').insert({ name: 'Chat Cut', default_duration_min: 30 }).select('id').single();
    serviceId = svc?.id || '';

    const now = new Date();
    await supabase.from('service_prices').insert({ service_id: serviceId, branch_id: branchId, price_amount: 50000, effective_from: now.toISOString() });

    const resCustomer = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `0812${suffix}`, password })
    }));
    const bodyCustomer = await resCustomer.json();
    customerToken = bodyCustomer.data.accessToken;

    const resBarber = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `barber${suffix}@test.com`, password })
    }));
    const bodyBarber = await resBarber.json();
    barberToken = bodyBarber.data.accessToken;

    const appointment = await supabase.from('appointments').insert({ branch_id: branchId, barber_id: barberId, customer_id: customerId, source: 'online_booking', status: 'confirmed' }).select('id').single();
    appointmentId = appointment.data!.id;
  });

  afterAll(async () => {
    await supabase.from('chat_messages').delete().eq('appointment_id', appointmentId);
    await supabase.from('appointments').delete().eq('id', appointmentId);
    await supabase.from('service_prices').delete().eq('service_id', serviceId);
    await supabase.from('services').delete().eq('id', serviceId);
    await supabase.from('barbers').delete().eq('id', barberId);
    await supabase.from('staff_users').delete().eq('id', barberStaffId);
    await supabase.from('customers').delete().eq('id', customerId);
    await supabase.from('branches').delete().eq('id', branchId);
    await supabase.from('regions').delete().eq('id', regionId);
  });

  it('1. Customer dapat mengambil riwayat chat kosong dengan pagination', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${appointmentId}/chat?page=1&limit=20`, {
      headers: { 'Authorization': `Bearer ${customerToken}` }
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it('2. Customer dan barber dapat mengirim pesan chat appointment', async () => {
    const customerSend = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${appointmentId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
      body: JSON.stringify({ text: 'Halo barber' })
    }));
    const customerBody = await customerSend.json();

    expect(customerSend.status).toBe(201);
    expect(customerBody.data.sender_role).toBe('customer');
    expect(customerBody.data.text).toBe('Halo barber');

    const barberSend = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/appointments/${appointmentId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${barberToken}` },
      body: JSON.stringify({ message: 'Saya segera sampai' })
    }));
    const barberBody = await barberSend.json();

    expect(barberSend.status).toBe(201);
    expect(barberBody.data.sender_role).toBe('barber');
    expect(barberBody.data.text).toBe('Saya segera sampai');

    const history = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${appointmentId}/chat`, {
      headers: { 'Authorization': `Bearer ${customerToken}` }
    }));
    const historyBody = await history.json();

    expect(history.status).toBe(200);
    expect(historyBody.data).toHaveLength(2);
  });
});
