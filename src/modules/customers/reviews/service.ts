import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { snakeKeys, camelKeys } from '../../../db/helpers';
import { appointments, reviews } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { asRpcResult, applyBarberRating, isDuplicateKeyError } from '../../../db/procedures';
import { logger } from '../../../lib/logger';

export class ReviewService {
  async createReview(appointmentId: string, customerId: string, payload: { rating: number, comment?: string, photo_url?: string, tip_amount?: number }) {
    // 1. Validasi Appointment
    const [apt] = await db
      .select({
        status: appointments.status,
        barber_id: appointments.barberId,
        customer_id: appointments.customerId,
        branch_id: appointments.branchId
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);

    if (!apt) throw new Error('Appointment tidak ditemukan.');
    if (apt.customer_id !== customerId) throw new Error('Anda tidak memiliki akses ke appointment ini.');
    if (apt.status !== 'completed') throw new Error('Review hanya bisa diberikan untuk appointment yang sudah selesai.');
    if (!apt.barber_id) throw new Error('Barber tidak ditemukan pada appointment ini.');
    if (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) {
      throw new Error('Rating harus berupa angka bulat antara 1 dan 5');
    }

    // 2. Insert Review (unique appointment_id = proteksi double-review).
    const reviewId = randomUUID();
    try {
      await db.insert(reviews).values(
        camelKeys({
          id: reviewId,
          appointment_id: appointmentId,
          customer_id: customerId,
          barber_id: apt.barber_id,
          branch_id: apt.branch_id,
          rating: payload.rating,
          comment: payload.comment,
          photo_url: payload.photo_url
        })
      );
    } catch (e: any) {
      if (isDuplicateKeyError(e)) {
        throw new Error('Anda sudah memberikan ulasan untuk appointment ini.');
      }
      throw new Error('Gagal menyimpan ulasan: ' + e?.message);
    }

    const [review] = snakeKeys(
      await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1)
    );

    // 3. Update agregat rating barber secara atomik (hindari lost-update saat
    //    beberapa review masuk bersamaan). (M5)
    const { error: ratingErr } = await asRpcResult(() =>
      applyBarberRating({ barberId: apt.barber_id as string, rating: payload.rating })
    );
    if (ratingErr) {
      logger.error({ err: ratingErr, appointmentId, barberId: apt.barber_id }, '[ReviewService] Gagal update rating barber');
    }

    return review;
  }
}
