import { ReviewService } from './service';
import { createSuccessResponse, createErrorResponse } from '../../../shared/response';

const service = new ReviewService();

export class ReviewController {
  static async create(ctx: any) {
    try {
      const appointmentId = ctx.params.id;
      const customerId = ctx.customerId; // dari middleware auth
      
      const data = await service.createReview(appointmentId, customerId, ctx.body);
      ctx.set.status = 201;
      return createSuccessResponse('Ulasan berhasil disimpan', data);
    } catch (error: any) {
      if (error.message.includes('sudah memberikan')) {
        ctx.set.status = 409;
        // Pesan asli WAJIB di field `message` (bukan `errors`) — klien membaca
        // `message` untuk mendeteksi kondisi "sudah pernah diulas" dan
        // memperlakukannya sebagai sukses idempoten. `code` memberi klien
        // pengait yang stabil tanpa string-matching.
        return createErrorResponse(error.message, null, 'REVIEW_ALREADY_EXISTS');
      }
      if (error.message.includes('sudah selesai') || error.message.includes('akses') || error.message.includes('Barber') || error.message.includes('tidak ditemukan') || error.message.includes('Rating')) {
        ctx.set.status = 400;
        return createErrorResponse(error.message, null, 'REVIEW_INVALID');
      }
      ctx.set.status = 500;
      return createErrorResponse(error.message, null, 'INTERNAL_ERROR');
    }
  }
}
