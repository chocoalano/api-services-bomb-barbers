import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { verifyAccessToken } from '../../../middleware/auth';
import { PasswordService } from './service';
import { AuditService } from '../audit/service';

export class PasswordController {
  static async updatePassword({ body, staffId, headers, set }: any) {
    try {
      const { current_password, new_password } = body;

      // Validasi: password baru tidak boleh sama dengan password lama
      if (current_password === new_password) {
        set.status = 400;
        return createErrorResponse('Password baru tidak boleh sama dengan password lama');
      }

      // Validasi: password baru minimal 8 karakter
      if (!new_password || new_password.length < 8) {
        set.status = 400;
        return createErrorResponse('Password baru minimal 8 karakter');
      }

      // Verifikasi current password
      const isValid = await PasswordService.verifyCurrentPassword(staffId, current_password);
      if (!isValid) {
        set.status = 403;
        return createErrorResponse('Password lama tidak sesuai');
      }

      // Update password
      await PasswordService.updatePassword(staffId, new_password);

      // Catat ke audit logs
      await AuditService.logAction(
        'admin',
        staffId,
        'CHANGE_PASSWORD',
        'staff_user',
        staffId,
        null,
        { password_changed: true }
      );

      // Invalidasi session lain (kecuali session saat ini)
      try {
        const authorization = headers?.authorization;
        if (authorization) {
          const payload = await verifyAccessToken(authorization);
          if (payload?.sid) {
            await PasswordService.invalidateOtherSessions(staffId, payload.sid);
          }
        }
      } catch {
        // Jika gagal invalidasi session lain, tetap lanjutkan
        // Password sudah berhasil diubah
      }

      return createSuccessResponse('Password berhasil diperbarui', null);
    } catch (err: any) {
      if (err.message?.includes('tidak memiliki password')) {
        set.status = 400;
        return createErrorResponse(err.message);
      }
      set.status = 500;
      return createErrorResponse(err.message || 'Terjadi kesalahan internal');
    }
  }
}
