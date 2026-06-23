import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { BarberPortfolioService } from './service';

export class BarberPortfolioController {
  static async upload({ body, staffId, set }: any) {
    try {
      const portfolio = await BarberPortfolioService.upload({
        staffId,
        file: body.file,
        caption: body.caption
      });
      set.status = 201;
      return createSuccessResponse('Portfolio berhasil diupload', portfolio);
    } catch (error: any) {
      set.status = 400;
      return createErrorResponse(error.message);
    }
  }

  static async list({ staffId, query, set }: any) {
    try {
      const res = await BarberPortfolioService.list(staffId, query ?? {});
      return createSuccessResponse('Daftar portfolio barber', res.data, res.meta);
    } catch (error: any) {
      set.status = 400;
      return createErrorResponse(error.message);
    }
  }

  static async remove({ params, staffId, set }: any) {
    try {
      await BarberPortfolioService.remove(staffId, params.id);
      return createSuccessResponse('Portfolio berhasil dihapus', null);
    } catch (error: any) {
      set.status = 400;
      return createErrorResponse(error.message);
    }
  }
}
