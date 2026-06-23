import { createErrorResponse, createSuccessResponse } from '../../../shared/response';
import { MediaService } from './service';

export class BarberMediaController {
  static async upload({ body, staffId, set }: any) {
    try {
      const media = await MediaService.uploadAppointmentImage({
        ownerType: 'staff',
        uploaderId: staffId,
        file: body.file,
        purpose: body.purpose
      });
      set.status = 201;
      return createSuccessResponse('Gambar berhasil diupload', media);
    } catch (error: any) {
      set.status = error.message.includes('Gagal mengupload') ||
        error.message.includes('Gagal mencatat') ||
        error.message.includes('Migration')
        ? 500
        : 400;
      return createErrorResponse(error.message);
    }
  }

  static async getSignedUrl({ params, staffId, set }: any) {
    try {
      const media = await MediaService.getPrivateAssetUrl(
        'staff',
        staffId,
        params.id
      );
      return createSuccessResponse('Signed URL media berhasil dibuat', media);
    } catch (error: any) {
      set.status = 404;
      return createErrorResponse(error.message);
    }
  }

  static async remove({ params, staffId, set }: any) {
    try {
      await MediaService.deletePrivateAsset('staff', staffId, params.id);
      return createSuccessResponse('Media berhasil dihapus', null);
    } catch (error: any) {
      set.status = error.message.includes('tidak ditemukan') ? 404 : 500;
      return createErrorResponse(error.message);
    }
  }
}
