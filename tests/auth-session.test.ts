import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { decodeJwt, SignJWT } from 'jose';
import * as argon2 from 'argon2';
import { app } from '../src/app';
import { testDb } from '../src/lib/test-db';
import { redis } from '../src/lib/redis';
import { SessionErrorCode } from '../src/core/auth/session-errors';

/**
 * [G1] Masa berlaku sesi.
 *
 * Yang dikunci di sini bukan "sesi berakhir", melainkan kebalikannya: sesi
 * TIDAK boleh berakhir sendiri. Token lama tanpa `exp` tetap diterima, token
 * kedaluwarsa masih bisa disegarkan, dan retry refresh yang responsnya hilang
 * tidak mencabut sesi siapa pun.
 */
const API_PREFIX = '/api/v1';
const password = 'Password123!';
const suffix = crypto.randomUUID().split('-')[0];

let customerId = '';
let accessToken = '';
let refreshToken = '';
const sessionIds = new Set<string>();

const remember = (token: string) => {
  const payload = decodeJwt(token);
  if (typeof payload.sid === 'string') sessionIds.add(payload.sid);
  return payload;
};

const refresh = async (token: string) =>
  app.handle(
    new Request(`http://localhost${API_PREFIX}/customers/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token })
    })
  );

const callMe = async (token: string) =>
  app.handle(
    new Request(`http://localhost${API_PREFIX}/customer/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  );

beforeAll(async () => {
  const passwordHash = await argon2.hash(password);
  const { data: customer, error } = await testDb
    .from('customers')
    .insert({
      full_name: 'Session Customer',
      email: `session-${suffix}@test.com`,
      phone: `905${suffix}`,
      password_hash: passwordHash
    })
    .select('id')
    .single();
  if (error) throw error;
  customerId = customer!.id;

  const response = await app.handle(
    new Request(`http://localhost${API_PREFIX}/customers/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `session-${suffix}@test.com`, password })
    })
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  accessToken = body.data.accessToken;
  refreshToken = body.data.refreshToken;
  remember(accessToken);
});

afterAll(async () => {
  for (const sid of sessionIds) await redis.del(`auth:session:${sid}`);
  await testDb.from('auth_sessions' as any).delete().eq('user_id', customerId);
  await testDb.from('auth_events' as any).delete().eq('user_id', customerId);
  await testDb.from('customers').delete().eq('id', customerId);
});

describe('[G1] masa berlaku access token', () => {
  it('token TANPA exp (terbitan lama) tetap diterima — rilis tidak melogout siapa pun', async () => {
    const sid = decodeJwt(accessToken).sid as string;
    const legacyToken = await new SignJWT({
      sub: customerId,
      role: 'customer',
      sid,
      jti: crypto.randomUUID()
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));

    expect(decodeJwt(legacyToken).exp).toBeUndefined();
    expect((await callMe(legacyToken)).status).toBe(200);
  });

  it('token kedaluwarsa ditolak 401 dengan kode TOKEN_EXPIRED (bukan kode terminal)', async () => {
    const sid = decodeJwt(accessToken).sid as string;
    const expiredToken = await new SignJWT({
      sub: customerId,
      role: 'customer',
      sid,
      jti: crypto.randomUUID()
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10 minutes ago')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));

    const response = await callMe(expiredToken);
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.code).toBe(SessionErrorCode.TOKEN_EXPIRED);
  });

  it('setelah token kedaluwarsa, refresh TETAP berhasil (bukan logout)', async () => {
    const response = await refresh(refreshToken);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.refreshToken).not.toBe(refreshToken);
    // Server merotasi refresh token — dipakai untuk kasus berikutnya.
    refreshToken = body.data.refreshToken;
    accessToken = body.data.accessToken;
    expect((await callMe(accessToken)).status).toBe(200);
  });

  it('selisih jam perangkat beberapa detik tidak membuat token ditolak', async () => {
    const sid = decodeJwt(accessToken).sid as string;
    const skewedToken = await new SignJWT({
      sub: customerId,
      role: 'customer',
      sid,
      jti: crypto.randomUUID()
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5 seconds ago')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));

    expect((await callMe(skewedToken)).status).toBe(200);
  });
});

describe('[G1] toleransi rotasi refresh token', () => {
  it('jti lama di dalam jendela toleransi diterima & sesi TIDAK dicabut', async () => {
    const stale = refreshToken;

    const first = await refresh(stale);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    refreshToken = firstBody.data.refreshToken;

    // Retry dengan jti lama — persis yang terjadi bila respons pertama hilang
    // di jaringan. Ini TIDAK boleh dibaca sebagai pencurian token.
    const retry = await refresh(stale);
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    refreshToken = retryBody.data.refreshToken;

    // Sesi masih hidup: access token yang sedang dipakai tetap berlaku.
    expect((await callMe(retryBody.data.accessToken)).status).toBe(200);
  });

  it('jti yang sudah lewat jendela toleransi dicabut sebagai reuse', async () => {
    const stale = refreshToken;
    const rotated = await refresh(stale);
    expect(rotated.status).toBe(200);
    refreshToken = (await rotated.json()).data.refreshToken;

    // Paksa jendela toleransi lewat tanpa menunggu 60 detik.
    const sid = decodeJwt(refreshToken).sid as string;
    await testDb
      .from('auth_sessions' as any)
      .update({ prev_jti_expires_at: '2000-01-01 00:00:00.000000' })
      .eq('id', sid);
    await redis.del(`auth:session:${sid}`);

    const reuse = await refresh(stale);
    const body = await reuse.json();
    expect(reuse.status).toBe(401);
    expect(body.code).toBe(SessionErrorCode.SESSION_REVOKED);
  });
});

describe('[G1] masa berlaku sesi di database', () => {
  it('AUTH_REFRESH_TTL_DAYS=0 (default) → sesi memakai sentinel tanpa batas', async () => {
    const response = await app.handle(
      new Request(`http://localhost${API_PREFIX}/customers/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `session-${suffix}@test.com`, password })
      })
    );
    const body = await response.json();
    const sid = remember(body.data.accessToken).sid as string;

    const { data: session } = await testDb
      .from('auth_sessions' as any)
      .select('expires_at')
      .eq('id', sid)
      .maybeSingle();

    expect(String(session?.expires_at).startsWith('9999-12-31')).toBe(true);
  });

  it('sesi yang expires_at-nya sudah lewat ditolak', async () => {
    const response = await app.handle(
      new Request(`http://localhost${API_PREFIX}/customers/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `session-${suffix}@test.com`, password })
      })
    );
    const body = await response.json();
    const token = body.data.accessToken;
    const sid = remember(token).sid as string;

    expect((await callMe(token)).status).toBe(200);

    await testDb
      .from('auth_sessions' as any)
      .update({ expires_at: '2001-01-01 00:00:00.000000' })
      .eq('id', sid);
    await redis.del(`auth:session:${sid}`);

    const expired = await callMe(token);
    expect(expired.status).toBe(401);
    expect((await expired.json()).code).toBe(SessionErrorCode.SESSION_REVOKED);
  });
});
