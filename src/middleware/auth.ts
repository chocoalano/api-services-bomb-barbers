import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { jwtVerify, type JWTVerifyOptions } from 'jose';
import { db } from '../lib/db';
import { customers, staffUsers } from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { AuthSessionService } from '../core/auth/session.service';
import { SessionError, SessionErrorCode } from '../core/auth/session-errors';
import { createErrorResponse } from '../shared/response';

// Fail-fast: jangan pernah boot dengan secret default yang bisa ditebak.
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error(
    'JWT_ACCESS_SECRET dan JWT_REFRESH_SECRET wajib di-set sebagai environment variable.'
  );
}

const ACCESS_TOKEN_SECRET = new TextEncoder().encode(JWT_ACCESS_SECRET);

/**
 * Verifikasi yang mengabaikan waktu sepenuhnya.
 *
 * Dipakai HANYA untuk refresh token: masa berlakunya diatur di baris
 * `auth_sessions` (bisa dicabut & diperpanjang server tanpa menyentuh
 * perangkat), bukan di klaim `exp` yang terlanjur beredar di ribuan HP.
 */
export const NON_EXPIRING_JWT_VERIFY_OPTIONS = {
  clockTolerance: Number.MAX_SAFE_INTEGER
} satisfies JWTVerifyOptions;

/**
 * Masa berlaku access token (menit). **0 = tanpa `exp`** — perilaku lama, dan
 * juga saklar darurat: kembalikan ke 0 tanpa deploy ulang bila penyalaan masa
 * berlaku menimbulkan masalah di lapangan.
 */
const ACCESS_TTL_MINUTES = Number(process.env.AUTH_ACCESS_TTL_MINUTES || 0);

/**
 * Toleransi selisih jam perangkat (detik). Jam HP yang meleset satu menit tidak
 * boleh berubah menjadi 401 beruntun.
 */
const ACCESS_CLOCK_TOLERANCE_SECONDS = Number(
  process.env.AUTH_ACCESS_CLOCK_TOLERANCE_SECONDS || 60
);

/** Klaim `exp` untuk token baru; null = jangan pasang exp sama sekali. */
export const accessTokenExpiryClaim = () =>
  ACCESS_TTL_MINUTES > 0
    ? Math.floor(Date.now() / 1000) + ACCESS_TTL_MINUTES * 60
    : null;

/**
 * Tambahkan klaim `exp` ke payload access token bila fitur ini aktif.
 * Dipakai semua penerbit token agar aturannya cuma ada di satu tempat.
 */
export const withAccessTokenExpiry = <T extends Record<string, unknown>>(payload: T) => {
  const exp = accessTokenExpiryClaim();
  return exp ? { ...payload, exp } : payload;
};

export const verifyAccessToken = async (token: string) => {
  const rawToken = token.startsWith('Bearer ') ? token.slice(7) : token;
  try {
    // Token TANPA `exp` (semua yang terbit sebelum fitur ini menyala) tetap
    // diterima — `jose` hanya menilai klaim yang ada. Itulah yang membuat rilis
    // ini tidak memutus satu pun sesi yang sedang berjalan.
    const { payload } = await jwtVerify(rawToken, ACCESS_TOKEN_SECRET, {
      algorithms: ['HS256'],
      clockTolerance: ACCESS_CLOCK_TOLERANCE_SECONDS
    });
    if (!payload || typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      throw new Error('Invalid token payload');
    }
    if (typeof payload.sid !== 'string') {
      throw new Error('Invalid session payload');
    }
    const typedPayload = payload as {
      sub: string;
      role: string;
      sid: string;
      exp?: number;
      iat?: number;
    };
    if (!['customer', 'staff'].includes(typedPayload.role)) {
      throw new Error('Invalid token role');
    }
    const userType = typedPayload.role === 'customer' ? 'customer' : 'staff';
    await AuthSessionService.assertActive(
      typedPayload.sid,
      userType,
      typedPayload.sub
    );
    return typedPayload;
  } catch (error: any) {
    // Sebab kegagalan DIPERTAHANKAN, tidak lagi diratakan jadi "Invalid token":
    // aplikasi memutuskan logout/tidak berdasarkan kodenya.
    if (error instanceof SessionError) throw error;
    if (error?.code === 'ERR_JWT_EXPIRED') {
      // Bukan kode terminal — klien wajib menyegarkan token, bukan melogout.
      throw SessionError.tokenExpired();
    }
    throw new Error('Token tidak valid');
  }
};

// Setup JWT instances
export const setupAuth = new Elysia()
  .use(
    jwt({
      name: 'jwtAccess',
      secret: JWT_ACCESS_SECRET
    })
  )
  .use(
    jwt({
      name: 'jwtRefresh',
      secret: JWT_REFRESH_SECRET
    })
  );

// Middleware for Customer
export const customerAuthMiddleware = (app: Elysia) =>
  app
    .use(setupAuth)
    .derive(async ({ headers: { authorization } }) => {
      let customerId = null;
      let authError = 'Missing or invalid token';
      let authCode: string | null = null;

      if (authorization?.startsWith('Bearer ')) {
        try {
          const payload = await verifyAccessToken(authorization);
          if (payload.role !== 'customer') {
            authError = 'Unauthorized access';
            return { customerId, authError, authCode };
          }
          const [customer] = await db
            .select({ isActive: customers.isActive, deletedAt: customers.deletedAt })
            .from(customers)
            .where(and(eq(customers.id, payload.sub), isNull(customers.deletedAt)))
            .limit(1);
          if (customer?.isActive && !customer.deletedAt) {
            customerId = payload.sub as string;
            authError = '';
          } else {
            authError = 'Akun Anda dinonaktifkan. Hubungi admin.';
            authCode = SessionErrorCode.ACCOUNT_SUSPENDED;
          }
        } catch (error: any) {
          authError = error?.message || 'Missing or invalid token';
          authCode = error instanceof SessionError ? error.code : null;
        }
      }
      return { customerId, authError, authCode };
    })
    .onBeforeHandle(({ customerId, authError, authCode, set }) => {
      if (authError || !customerId) {
        set.status = 401;
        return createErrorResponse(authError || 'Unauthorized', null, authCode ?? null, null, {
          context: 'customerAuthMiddleware',
          status: 401
        });
      }
    });

// Middleware for Staff
export const staffAuthMiddleware = (app: Elysia) =>
  app
    .use(setupAuth)
    .derive(async ({ headers, query }: any) => {
      let staffId = null;
      let authError = 'Missing or invalid token';
      let authCode: string | null = null;

      const authorization = headers?.authorization;
      // Token via ?token= HANYA diterima untuk request SSE (EventSource browser
      // tidak bisa set custom header). Membatasi ini mencegah token akses bocor ke
      // log/history/Referer pada endpoint biasa. (M9)
      const acceptsEventStream = String(headers?.accept || '').includes('text/event-stream');
      const rawToken = authorization?.startsWith('Bearer ')
        ? authorization
        : (acceptsEventStream && query?.token)
          ? `Bearer ${query.token}`
          : null;

      if (rawToken) {
        try {
          const payload = await verifyAccessToken(rawToken);
          if (payload.role !== 'staff') {
            authError = 'Unauthorized access';
            return { staffId, authError, authCode };
          }
          const [staff] = await db
            .select({ isActive: staffUsers.isActive, deletedAt: staffUsers.deletedAt })
            .from(staffUsers)
            .where(and(eq(staffUsers.id, payload.sub), isNull(staffUsers.deletedAt)))
            .limit(1);
          if (staff?.isActive && !staff.deletedAt) {
            staffId = payload.sub as string;
            authError = '';
          } else {
            authError = 'Akun Anda dinonaktifkan. Hubungi admin.';
            authCode = SessionErrorCode.ACCOUNT_SUSPENDED;
          }
        } catch (error: any) {
          authError = error?.message || 'Missing or invalid token';
          authCode = error instanceof SessionError ? error.code : null;
        }
      }
      return { staffId, authError, authCode };
    })
    .onBeforeHandle(({ staffId, authError, authCode, set }) => {
      if (authError || !staffId) {
        set.status = 401;
        return createErrorResponse(authError || 'Unauthorized', null, authCode ?? null, null, {
          context: 'staffAuthMiddleware',
          status: 401
        });
      }
    });
