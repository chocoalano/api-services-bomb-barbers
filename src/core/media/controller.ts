import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { MediaService } from './service';
import { verifyAccessToken } from '../../middleware/auth';

export class MediaController {
  static async upload({ body, headers, set }: any) {
    try {
      if (!headers?.authorization) {
        set.status = 401;
        return createErrorResponse('Token tidak ditemukan');
      }

      const payload = await verifyAccessToken(headers.authorization);
      if (!['customer', 'staff'].includes(payload.role)) {
        set.status = 403;
        return createErrorResponse('Role tidak diizinkan untuk mengupload');
      }

      const media = await MediaService.uploadAppointmentImage({
        ownerType: payload.role === 'customer' ? 'customer' : 'staff',
        uploaderId: payload.sub,
        file: body.file,
        purpose: body.purpose
      });

      set.status = 201;
      return createSuccessResponse('Gambar berhasil diupload', media);
    } catch (error: any) {
      if (error.message === 'Invalid token') {
        set.status = 401;
        return createErrorResponse('Token tidak valid atau sudah kadaluarsa');
      }
      set.status = error.message.includes('Gagal mengupload') ? 500 : 400;
      return createErrorResponse(error.message);
    }
  }
}
