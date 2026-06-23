import { createErrorResponse, createSuccessResponse } from '../../../shared/response';
import { MediaService } from './service';

export class CustomerMediaController {
  static async upload({ body, customerId, set }: any) {
    try {
      const media = await MediaService.uploadAppointmentImage({
        ownerType: 'customer',
        uploaderId: customerId,
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

  static async getSignedUrl({ params, customerId, set }: any) {
    try {
      const media = await MediaService.getPrivateAssetUrl(
        'customer',
        customerId,
        params.id
      );
      return createSuccessResponse('Signed URL media berhasil dibuat', media);
    } catch (error: any) {
      set.status = 404;
      return createErrorResponse(error.message);
    }
  }

  static async remove({ params, customerId, set }: any) {
    try {
      await MediaService.deletePrivateAsset('customer', customerId, params.id);
      return createSuccessResponse('Media berhasil dihapus', null);
    } catch (error: any) {
      set.status = error.message.includes('tidak ditemukan') ? 404 : 500;
      return createErrorResponse(error.message);
    }
  }
}
