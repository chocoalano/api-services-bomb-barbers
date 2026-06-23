import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { CustomerAuthService } from './service';
import { AuthSessionService } from '../../../core/auth/session.service';
import {
  AuthRateLimitError,
  AuthSecurityService,
  getAuthRequestMetadata
} from '../../../core/auth/security.service';

export class CustomerAuthController {
  static async register({ body, set }: any) {
    try {
      const newCustomer = await CustomerAuthService.register(body);
      set.status = 201;
      return createSuccessResponse('Pelanggan berhasil didaftarkan', newCustomer);
    } catch (error: any) {
      set.status = error.message.includes('sudah terdaftar') ? 409 : 400;
      return createErrorResponse(error.message);
    }
  }

  static async login({ body, jwtAccess, jwtRefresh, request, set }: any) {
    try {
      const metadata = getAuthRequestMetadata(request);
      const identifier = body.email || body.phone || 'unknown';
      const rateLimit = await AuthSecurityService.assertLoginAllowed(
        'customer',
        identifier,
        metadata
      );
      let customer;
      try {
        customer = await CustomerAuthService.login(body);
      } catch (error: any) {
        await AuthSecurityService.recordLoginFailure({
          userType: 'customer',
          key: rateLimit.key,
          identifierHash: rateLimit.identifierHash,
          metadata,
          reason: error.message
        });
        throw error;
      }

      const refreshJti = crypto.randomUUID();
      const session = await AuthSessionService.create(
        'customer',
        customer.id,
        refreshJti,
        metadata
      );
      const accessToken = await jwtAccess.sign({
        sub: customer.id,
        role: 'customer',
        sid: session.id,
        jti: crypto.randomUUID()
      });
      const refreshToken = await jwtRefresh.sign({
        sub: customer.id,
        role: 'customer',
        sid: session.id,
        jti: refreshJti
      });
      await AuthSecurityService.recordLoginSuccess({
        userType: 'customer',
        userId: customer.id,
        key: rateLimit.key,
        identifierHash: rateLimit.identifierHash,
        metadata
      });

      return createSuccessResponse('Login berhasil', { accessToken, refreshToken });
    } catch (error: any) {
      if (error instanceof AuthRateLimitError) {
        set.status = 429;
        set.headers['Retry-After'] = String(error.retryAfterSeconds);
      } else if (error.message.includes('tidak aktif')) {
        set.status = 403;
      } else if (
        error.message.includes('wajib') ||
        error.message.includes('minimal') ||
        error.message.includes('berupa teks')
      ) {
        set.status = 400;
      } else {
        set.status = 401;
      }
      return createErrorResponse(error.message);
    }
  }

  static async refresh({ body, jwtAccess, jwtRefresh, request, set }: any) {
    try {
      const metadata = getAuthRequestMetadata(request);
      await AuthSecurityService.assertRefreshAllowed(metadata);
      const payload = await jwtRefresh.verify(body.refreshToken);
      if (
        !payload ||
        payload.role !== 'customer' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.jti !== 'string'
      ) {
        throw new Error('Refresh token tidak valid');
      }
      const customer = await CustomerAuthService.verifyRefresh(payload);

      const newRefreshJti = crypto.randomUUID();
      await AuthSessionService.rotate(
        payload.sid,
        'customer',
        customer.id,
        payload.jti,
        newRefreshJti
      );
      const accessToken = await jwtAccess.sign({
        sub: customer.id,
        role: 'customer',
        sid: payload.sid,
        jti: crypto.randomUUID()
      });
      const newRefreshToken = await jwtRefresh.sign({
        sub: customer.id,
        role: 'customer',
        sid: payload.sid,
        jti: newRefreshJti
      });
      await AuthSecurityService.recordSessionEvent(
        'customer',
        customer.id,
        'token_refreshed',
        metadata
      );

      return createSuccessResponse('Token berhasil diperbarui', { accessToken, refreshToken: newRefreshToken });
    } catch (error: any) {
      if (error instanceof AuthRateLimitError) {
        set.status = 429;
        set.headers['Retry-After'] = String(error.retryAfterSeconds);
      } else {
        set.status = 401;
      }
      return createErrorResponse(error.message);
    }
  }

  static async logout({ body, jwtRefresh, request, set }: any) {
    try {
      const payload = await jwtRefresh.verify(body.refreshToken);
      if (
        !payload ||
        payload.role !== 'customer' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string'
      ) {
        throw new Error('Refresh token tidak valid');
      }
      await AuthSessionService.revoke(payload.sid, 'logout');
      await AuthSecurityService.recordSessionEvent(
        'customer',
        payload.sub,
        'logout',
        getAuthRequestMetadata(request)
      );
      return createSuccessResponse('Logout berhasil', null);
    } catch (error: any) {
      set.status = 401;
      return createErrorResponse(error.message);
    }
  }

  static async updateProfile({ body, customerId, set }: any) {
    try {
      const profile = await CustomerAuthService.updateProfile(customerId, body ?? {});
      return createSuccessResponse('Profil berhasil diperbarui', profile);
    } catch (error: any) {
      set.status = error.message.includes('wajib') || error.message.includes('tidak ada') ? 400 : 400;
      return createErrorResponse(error.message);
    }
  }

  static async getProfile({ customerId, set }: any) {
    try {
      const profile = await CustomerAuthService.getProfile(customerId);
      return createSuccessResponse('Profil pelanggan berhasil diambil', profile);
    } catch (error: any) {
      set.status = 404;
      return createErrorResponse(error.message);
    }
  }
}
