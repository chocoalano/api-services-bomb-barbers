import { createErrorResponse, createSuccessResponse } from '../../../shared/response';
import { MediaService } from './service';

export class AdminMediaController {
  static async upload({ body, staffId, set }: any) {
    try {
      const media = await MediaService.uploadContentImage({
        uploaderId: staffId,
        file: body.file,
        category: body.category
      });
      set.status = 201;
      return createSuccessResponse('Gambar berhasil diupload', media);
    } catch (error: any) {
      set.status = 400;
      return createErrorResponse(error.message);
    }
  }
}
