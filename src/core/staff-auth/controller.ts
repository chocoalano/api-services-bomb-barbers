import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { StaffAuthService } from './service';
import { AuthSessionService } from '../auth/session.service';
import { NON_EXPIRING_JWT_VERIFY_OPTIONS } from '../../middleware/auth';
import {
  AuthRateLimitError,
  AuthSecurityService,
  getAuthRequestMetadata
} from '../auth/security.service';

export class StaffAuthController {
  // `options.allowedRoles` membatasi login ke role tertentu. Dipakai oleh login
  // backoffice (`/api/v1/admin/auth/login`) agar hanya super_admin & branch_admin
  // yang bisa masuk, tanpa memengaruhi login staff/kepster yang memakai handler
  // yang sama tanpa gate ini.
  static async login(
    { body, jwtAccess, jwtRefresh, request, server, set }: any,
    options: { allowedRoles?: string[] } = {}
  ) {
    try {
      const metadata = getAuthRequestMetadata(request, server);
      const rateLimit = await AuthSecurityService.assertLoginAllowed(
        'staff',
        body.email || 'unknown',
        metadata
      );
      let staff;
      try {
        staff = await StaffAuthService.login(body);

        // Gate role backoffice: tolak akun yang tidak memiliki salah satu role
        // yang diizinkan (mis. kepster/barber mencoba masuk ke panel admin).
        if (
          options.allowedRoles &&
          !staff.roles.some((role: string) => options.allowedRoles!.includes(role))
        ) {
          const forbidden = new Error(
            'Akun ini tidak memiliki akses ke backoffice'
          ) as Error & { status?: number };
          forbidden.status = 403;
          throw forbidden;
        }
      } catch (error: any) {
        await AuthSecurityService.recordLoginFailure({
          userType: 'staff',
          key: rateLimit.key,
          identifierHash: rateLimit.identifierHash,
          metadata,
          reason: error.message
        });
        throw error;
      }

      const refreshJti = crypto.randomUUID();
      const session = await AuthSessionService.create(
        'staff',
        staff.id,
        refreshJti,
        metadata
      );
      const accessToken = await jwtAccess.sign({
        sub: staff.id,
        role: 'staff',
        sid: session.id,
        jti: crypto.randomUUID()
      });
      const refreshToken = await jwtRefresh.sign({
        sub: staff.id,
        role: 'staff',
        sid: session.id,
        jti: refreshJti
      });
      await AuthSecurityService.recordLoginSuccess({
        userType: 'staff',
        userId: staff.id,
        key: rateLimit.key,
        identifierHash: rateLimit.identifierHash,
        metadata
      });

      return createSuccessResponse('Login berhasil', {
        accessToken,
        refreshToken,
        staff: {
          id: staff.id,
          full_name: staff.full_name,
          email: staff.email,
          roles: staff.roles,
          permissions: staff.permissions,
          branch_ids: staff.branchIds,
          is_global: staff.isGlobal
        }
      });
    } catch (error: any) {
      if (error instanceof AuthRateLimitError) {
        set.status = 429;
        set.headers['Retry-After'] = String(error.retryAfterSeconds);
      } else if (typeof error.status === 'number') {
        // [REVISI C1] Hormati status eksplisit (mis. 403 gating persetujuan kepster).
        set.status = error.status;
      } else if (error.message.includes('tidak aktif')) {
        set.status = 403;
      } else {
        set.status = 401;
      }
      return createErrorResponse(error.message);
    }
  }

  // [REVISI C1] Pendaftaran mandiri kepster (publik). Tidak menerbitkan JWT.
  static async register({ body, set }: any) {
    try {
      await StaffAuthService.register(body);
      set.status = 201;
      return createSuccessResponse('Pendaftaran diterima, menunggu konfirmasi admin', null);
    } catch (error: any) {
      set.status = typeof error.status === 'number' ? error.status : 400;
      return createErrorResponse(error.message);
    }
  }

  static async refresh({ body, jwtAccess, jwtRefresh, request, server, set }: any) {
    try {
      const metadata = getAuthRequestMetadata(request, server);
      await AuthSecurityService.assertRefreshAllowed(metadata);
      const payload = await jwtRefresh.verify(body.refreshToken, NON_EXPIRING_JWT_VERIFY_OPTIONS);
      if (
        !payload ||
        payload.role !== 'staff' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.jti !== 'string'
      ) {
        throw new Error('Refresh token tidak valid');
      }
      const staff = await StaffAuthService.verifyRefresh(payload);

      const newRefreshJti = crypto.randomUUID();
      await AuthSessionService.rotate(
        payload.sid,
        'staff',
        staff.id,
        payload.jti,
        newRefreshJti
      );
      const accessToken = await jwtAccess.sign({
        sub: staff.id,
        role: 'staff',
        sid: payload.sid,
        jti: crypto.randomUUID()
      });
      const newRefreshToken = await jwtRefresh.sign({
        sub: staff.id,
        role: 'staff',
        sid: payload.sid,
        jti: newRefreshJti
      });
      await AuthSecurityService.recordSessionEvent(
        'staff',
        staff.id,
        'token_refreshed',
        metadata
      );

      return createSuccessResponse('Token berhasil diperbarui', {
        accessToken,
        refreshToken: newRefreshToken,
        staff: {
          id: staff.id,
          full_name: staff.full_name,
          email: staff.email,
          roles: staff.roles,
          permissions: staff.permissions,
          branch_ids: staff.branchIds,
          is_global: staff.isGlobal
        }
      });
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

  static async logout({ body, jwtRefresh, request, server, set }: any) {
    try {
      const payload = await jwtRefresh.verify(body.refreshToken, NON_EXPIRING_JWT_VERIFY_OPTIONS);
      if (
        !payload ||
        payload.role !== 'staff' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string'
      ) {
        throw new Error('Refresh token tidak valid');
      }
      await AuthSessionService.revoke(payload.sid, 'logout');
      await AuthSecurityService.recordSessionEvent(
        'staff',
        payload.sub,
        'logout',
        getAuthRequestMetadata(request, server)
      );
      return createSuccessResponse('Logout berhasil', null);
    } catch (error: any) {
      set.status = 401;
      return createErrorResponse(error.message);
    }
  }

  static async getProfile({ staffId, set }: any) {
    try {
      const profile = await StaffAuthService.getProfile(staffId);
      return createSuccessResponse('Profil staff berhasil diambil', profile);
    } catch (error: any) {
      set.status = 404;
      return createErrorResponse(error.message);
    }
  }
}
