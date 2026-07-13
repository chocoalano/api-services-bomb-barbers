import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { jwtVerify, type JWTVerifyOptions } from 'jose';
import { db } from '../lib/db';
import { customers, staffUsers } from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { AuthSessionService } from '../core/auth/session.service';
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
export const NON_EXPIRING_JWT_VERIFY_OPTIONS = {
  clockTolerance: Number.MAX_SAFE_INTEGER
} satisfies JWTVerifyOptions;

export const verifyAccessToken = async (token: string) => {
  const rawToken = token.startsWith('Bearer ') ? token.slice(7) : token;
  try {
    const { payload } = await jwtVerify(rawToken, ACCESS_TOKEN_SECRET, {
      algorithms: ['HS256'],
      ...NON_EXPIRING_JWT_VERIFY_OPTIONS
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
  } catch (error) {
    throw new Error('Invalid token');
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
    .derive(async ({ jwtAccess, headers: { authorization } }) => {
      let customerId = null;
      let authError = 'Missing or invalid token';

      if (authorization?.startsWith('Bearer ')) {
        try {
          const payload = await verifyAccessToken(authorization);
          if (payload.role !== 'customer') {
            authError = 'Unauthorized access';
            return { customerId, authError };
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
            authError = 'User is inactive or not found';
          }
        } catch {
          authError = 'Missing or invalid token';
        }
      }
      return { customerId, authError };
    })
    .onBeforeHandle(({ customerId, authError, set }) => {
      if (authError || !customerId) {
        set.status = 401;
        return createErrorResponse(authError || 'Unauthorized', null, null, null, {
          context: 'customerAuthMiddleware',
          status: 401
        });
      }
    });

// Middleware for Staff
export const staffAuthMiddleware = (app: Elysia) =>
  app
    .use(setupAuth)
    .derive(async ({ jwtAccess, headers, query }: any) => {
      let staffId = null;
      let authError = 'Missing or invalid token';

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
            return { staffId, authError };
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
            authError = 'User is inactive or not found';
          }
        } catch {
          authError = 'Missing or invalid token';
        }
      }
      return { staffId, authError };
    })
    .onBeforeHandle(({ staffId, authError, set }) => {
      if (authError || !staffId) {
        set.status = 401;
        return createErrorResponse(authError || 'Unauthorized', null, null, null, {
          context: 'staffAuthMiddleware',
          status: 401
        });
      }
    });
