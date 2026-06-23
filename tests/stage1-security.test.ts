import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { decodeJwt } from 'jose';
import * as argon2 from 'argon2';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import { redis } from '../src/lib/redis';

const API_PREFIX = '/api/v1';
const password = 'Password123!';
const suffix = crypto.randomUUID().split('-')[0];

let regionId = '';
let branchId = '';
let barberStaffId = '';
let barberId = '';
let rotateCustomerId = '';
let logoutCustomerId = '';
let deletedCustomerId = '';
let mediaCustomerId = '';
let barberToken = '';
let rotateAccessToken = '';
let rotateRefreshToken = '';
let rotatedAccessToken = '';
let logoutAccessToken = '';
let logoutRefreshToken = '';
let deletedAccessToken = '';
let mediaCustomerToken = '';
const sessionIds = new Set<string>();

const tinyPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5,
  0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130
]);

const rememberSession = (token: string) => {
  const payload = decodeJwt(token);
  if (typeof payload.sid === 'string') sessionIds.add(payload.sid);
};

const loginCustomer = async (email: string) => {
  const response = await app.handle(new Request(
    `http://localhost${API_PREFIX}/customer/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }
  ));
  const payload = await response.json();
  expect(response.status).toBe(200);
  rememberSession(payload.data.accessToken);
  return payload.data as { accessToken: string; refreshToken: string };
};

beforeAll(async () => {
  const passwordHash = await argon2.hash(password);

  const { data: region } = await supabase
    .from('regions')
    .insert({ code: `S1${suffix.slice(-4)}`, name: 'Stage 1 Security Region' })
    .select('id')
    .single();
  regionId = region!.id;

  const { data: branch } = await supabase
    .from('branches')
    .insert({ name: 'Stage 1 Security Branch', region_id: regionId })
    .select('id')
    .single();
  branchId = branch!.id;

  const customerRows = [
    {
      full_name: 'Rotate Customer',
      email: `rotate-${suffix}@test.com`,
      phone: `901${suffix}`,
      password_hash: passwordHash
    },
    {
      full_name: 'Logout Customer',
      email: `logout-${suffix}@test.com`,
      phone: `902${suffix}`,
      password_hash: passwordHash
    },
    {
      full_name: 'Deleted Customer',
      email: `deleted-${suffix}@test.com`,
      phone: `903${suffix}`,
      password_hash: passwordHash
    },
    {
      full_name: 'Media Customer',
      email: `media-${suffix}@test.com`,
      phone: `904${suffix}`,
      password_hash: passwordHash
    }
  ];
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .insert(customerRows)
    .select('id, email');
  if (customerError) throw customerError;
  rotateCustomerId = customers!.find((item) => item.email.startsWith('rotate-'))!.id;
  logoutCustomerId = customers!.find((item) => item.email.startsWith('logout-'))!.id;
  deletedCustomerId = customers!.find((item) => item.email.startsWith('deleted-'))!.id;
  mediaCustomerId = customers!.find((item) => item.email.startsWith('media-'))!.id;

  const { data: barberStaff, error: staffError } = await supabase
    .from('staff_users')
    .insert({
      full_name: 'Stage 1 Barber',
      email: `barber-${suffix}@test.com`,
      password_hash: passwordHash
    })
    .select('id')
    .single();
  if (staffError) throw staffError;
  barberStaffId = barberStaff!.id;

  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .insert({
      staff_user_id: barberStaffId,
      branch_id: branchId,
      display_name: 'Stage 1 Barber'
    })
    .select('id')
    .single();
  if (barberError) throw barberError;
  barberId = barber!.id;

  const rotateLogin = await loginCustomer(`rotate-${suffix}@test.com`);
  rotateAccessToken = rotateLogin.accessToken;
  rotateRefreshToken = rotateLogin.refreshToken;

  const logoutLogin = await loginCustomer(`logout-${suffix}@test.com`);
  logoutAccessToken = logoutLogin.accessToken;
  logoutRefreshToken = logoutLogin.refreshToken;

  const deletedLogin = await loginCustomer(`deleted-${suffix}@test.com`);
  deletedAccessToken = deletedLogin.accessToken;

  const mediaLogin = await loginCustomer(`media-${suffix}@test.com`);
  mediaCustomerToken = mediaLogin.accessToken;

  const barberLoginResponse = await app.handle(new Request(
    `http://localhost${API_PREFIX}/barber/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `barber-${suffix}@test.com`,
        password
      })
    }
  ));
  const barberLogin = await barberLoginResponse.json();
  if (barberLoginResponse.status !== 200) throw new Error(JSON.stringify(barberLogin));
  barberToken = barberLogin.data.accessToken;
  rememberSession(barberToken);
});

afterAll(async () => {
  for (const sessionId of sessionIds) {
    await redis.del(`auth:session:${sessionId}`);
  }
  await supabase
    .from('auth_sessions' as any)
    .delete()
    .in('user_id', [
      rotateCustomerId,
      logoutCustomerId,
      deletedCustomerId,
      mediaCustomerId,
      barberStaffId
    ].filter(Boolean));
  await supabase
    .from('auth_events' as any)
    .delete()
    .in('user_id', [
      rotateCustomerId,
      logoutCustomerId,
      deletedCustomerId,
      mediaCustomerId,
      barberStaffId
    ].filter(Boolean));
  await supabase.from('barbers').delete().eq('id', barberId);
  await supabase.from('staff_users').delete().eq('id', barberStaffId);
  await supabase
    .from('customers')
    .delete()
    .in('id', [rotateCustomerId, logoutCustomerId, deletedCustomerId, mediaCustomerId]);
  await supabase.from('branches').delete().eq('id', branchId);
  await supabase.from('regions').delete().eq('id', regionId);
});

describe('Tahap 1 - auth session security', () => {
  it('merotasi refresh token dan menolak pemakaian ulang token lama', async () => {
    const refreshResponse = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rotateRefreshToken })
      }
    ));
    const refreshPayload = await refreshResponse.json();

    expect(refreshResponse.status).toBe(200);
    expect(refreshPayload.data.refreshToken).not.toBe(rotateRefreshToken);
    rotatedAccessToken = refreshPayload.data.accessToken;
    rememberSession(rotatedAccessToken);

    const reuseResponse = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rotateRefreshToken })
      }
    ));
    expect(reuseResponse.status).toBe(401);

    const accessAfterReuse = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/me`,
      {
        headers: { Authorization: `Bearer ${rotatedAccessToken}` }
      }
    ));
    expect(accessAfterReuse.status).toBe(401);
  });

  it('logout mencabut access token dalam session yang sama', async () => {
    const logoutResponse = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/auth/logout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: logoutRefreshToken })
      }
    ));
    expect(logoutResponse.status).toBe(200);

    const profileResponse = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/me`,
      {
        headers: { Authorization: `Bearer ${logoutAccessToken}` }
      }
    ));
    expect(profileResponse.status).toBe(401);
  });

  it('akun customer soft-delete langsung kehilangan akses REST', async () => {
    await supabase
      .from('customers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', deletedCustomerId);

    const response = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/me`,
      {
        headers: { Authorization: `Bearer ${deletedAccessToken}` }
      }
    ));
    expect(response.status).toBe(401);
  });
});

describe('Tahap 1 - isolasi route media', () => {
  it('menolak token barber pada route media customer', async () => {
    const form = new FormData();
    form.set('file', new File([tinyPng], 'test.png', { type: 'image/png' }));

    const response = await app.handle(new Request(
      `http://localhost${API_PREFIX}/customer/media/upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${barberToken}` },
        body: form
      }
    ));
    expect(response.status).toBe(401);
  });

  it('menolak token customer pada route media barber', async () => {
    const form = new FormData();
    form.set('file', new File([tinyPng], 'test.png', { type: 'image/png' }));

    const response = await app.handle(new Request(
      `http://localhost${API_PREFIX}/barber/media/upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${mediaCustomerToken}` },
        body: form
      }
    ));
    expect(response.status).toBe(401);
  });
});

describe('Tahap 1 - soft delete staff', () => {
  it('akun staff soft-delete langsung kehilangan akses barber', async () => {
    await supabase
      .from('staff_users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', barberStaffId);

    const response = await app.handle(new Request(
      `http://localhost${API_PREFIX}/barber/me`,
      {
        headers: { Authorization: `Bearer ${barberToken}` }
      }
    ));
    expect(response.status).toBe(401);
  });
});
