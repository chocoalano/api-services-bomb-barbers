import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { jwtVerify } from 'jose';
import { supabase } from '../lib/supabase';
import { AuthSessionService } from '../core/auth/session.service';

// Fail-fast: jangan pernah boot dengan secret default yang bisa ditebak.
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error(
    'JWT_ACCESS_SECRET dan JWT_REFRESH_SECRET wajib di-set sebagai environment variable.'
  );
}

const ACCESS_TOKEN_SECRET = new TextEncoder().encode(JWT_ACCESS_SECRET);

export const verifyAccessToken = async (token: string) => {
  const rawToken = token.startsWith('Bearer ') ? token.slice(7) : token;
  try {
    const { payload } = await jwtVerify(rawToken, ACCESS_TOKEN_SECRET);
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
      secret: JWT_ACCESS_SECRET,
      exp: '15m'
    })
  )
  .use(
    jwt({
      name: 'jwtRefresh',
      secret: JWT_REFRESH_SECRET,
      exp: '7d'
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
          const { data: customer } = await supabase
            .from('customers')
            .select('id, is_active, deleted_at')
            .eq('id', payload.sub)
            .is('deleted_at', null)
            .maybeSingle();
          if (customer?.is_active && !customer.deleted_at) {
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
        return { success: false, message: authError || 'Unauthorized', data: null };
      }
    });

// Middleware for Staff
export const staffAuthMiddleware = (app: Elysia) =>
  app
    .use(setupAuth)
    .derive(async ({ jwtAccess, headers: { authorization }, query }: any) => {
      let staffId = null;
      let authError = 'Missing or invalid token';

      // Accept token via Authorization header or ?token= query param (SSE fallback for
      // browser-native EventSource which cannot set custom headers).
      const rawToken = authorization?.startsWith('Bearer ')
        ? authorization
        : query?.token
          ? `Bearer ${query.token}`
          : null;

      if (rawToken) {
        try {
          const payload = await verifyAccessToken(rawToken);
          if (payload.role !== 'staff') {
            authError = 'Unauthorized access';
            return { staffId, authError };
          }
          const { data: staff } = await supabase
            .from('staff_users')
            .select('id, is_active, deleted_at')
            .eq('id', payload.sub)
            .is('deleted_at', null)
            .maybeSingle();
          if (staff?.is_active && !staff.deleted_at) {
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
        return { success: false, message: authError || 'Unauthorized', data: null };
      }
    });
