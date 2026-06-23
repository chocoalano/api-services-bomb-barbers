import { describe, expect, it, beforeAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Auth Module', () => {
  let staffId = '';
  let inactiveStaffId = '';
  const testPhone = '081234567000';
  const testCustomerEmail = 'testcustomer@bombbarbershop.com';
  const testStaffEmail = 'teststaff@bombbarbershop.com';
  const testInactiveEmail = 'inactive@bombbarbershop.com';
  const password = 'Password123!';

  beforeAll(async () => {
    // Cleanup first
    await supabase.from('customers').delete().eq('phone', testPhone);
    await supabase.from('customers').delete().eq('email', testCustomerEmail);
    await supabase.from('staff_users').delete().in('email', [testStaffEmail, testInactiveEmail]);

    const password_hash = await argon2.hash(password);

    // Create staff user
    const { data: staff } = await supabase.from('staff_users').insert({
      full_name: 'Test Staff',
      email: testStaffEmail,
      is_active: true,
      password_hash
    }).select('id').single();
    if(staff) staffId = staff.id;

    // Create inactive staff user
    const { data: inactiveStaff } = await supabase.from('staff_users').insert({
      full_name: 'Inactive Staff',
      email: testInactiveEmail,
      is_active: false,
      password_hash
    }).select('id').single();
    if(inactiveStaff) inactiveStaffId = inactiveStaff.id;
  });

  it('1. Register customer sukses', async () => {
    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/customer/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Test Customer',
          email: testCustomerEmail,
          phone: testPhone,
          password
        })
      })
    );
    const body = await res.json();
    console.log('Register response:', res.status, body);
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.phone).toBe(testPhone);
    expect(body.data.email).toBe(testCustomerEmail);
  });

  it('2. Login customer sukses dengan nomor telepon', async () => {
    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone,
          password
        })
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).toBeDefined();
  });

  it('3. Login customer sukses dengan email', async () => {
    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testCustomerEmail,
          password
        })
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).toBeDefined();
  });

  it('4. Login staff sukses', async () => {
    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testStaffEmail,
          password
        })
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
  });

  it('5. Token invalid ditolak', async () => {
    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/customer/me`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer invalid-token-123'
        }
      })
    );
    const body = await res.json();
    console.log('Test 4 response:', res.status, body);
    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('6. Staff nonaktif tidak bisa login', async () => {
    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testInactiveEmail,
          password
        })
      })
    );
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
  });
});
