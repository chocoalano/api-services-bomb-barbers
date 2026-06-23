import { supabase } from '../../../lib/supabase';

export class ReviewService {
  async createReview(appointmentId: string, customerId: string, payload: { rating: number, comment?: string, photo_url?: string, tip_amount?: number }) {
    // 1. Validasi Appointment
    const { data: apt, error: aptErr } = await supabase
      .from('appointments')
      .select('status, barber_id, customer_id, branch_id')
      .eq('id', appointmentId)
      .single();

    if (aptErr || !apt) throw new Error('Appointment tidak ditemukan.');
    if (apt.customer_id !== customerId) throw new Error('Anda tidak memiliki akses ke appointment ini.');
    if (apt.status !== 'completed') throw new Error('Review hanya bisa diberikan untuk appointment yang sudah selesai.');
    if (!apt.barber_id) throw new Error('Barber tidak ditemukan pada appointment ini.');
    if (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) {
      throw new Error('Rating harus berupa angka bulat antara 1 dan 5');
    }

    // 2. Insert Review. Fallback menjaga kompatibilitas DB lama yang belum punya branch_id/photo_url.
    const reviewPayload: any = {
      appointment_id: appointmentId,
      customer_id: customerId,
      barber_id: apt.barber_id,
      branch_id: apt.branch_id,
      rating: payload.rating,
      comment: payload.comment,
      photo_url: payload.photo_url
    };

    let { data: review, error: revErr } = await supabase
      .from('reviews')
      .insert(reviewPayload)
      .select('*')
      .single();

    if (
      revErr &&
      (revErr.message.includes('branch_id') || revErr.message.includes('photo_url'))
    ) {
      const legacyPayload = {
        appointment_id: appointmentId,
        customer_id: customerId,
        barber_id: apt.barber_id,
        rating: payload.rating,
        comment: payload.comment
      };

      const retry = await supabase
        .from('reviews')
        .insert(legacyPayload)
        .select('*')
        .single();

      review = retry.data;
      revErr = retry.error;
    }

    if (revErr) {
      if (revErr.code === '23505') { // Unique constraint violation
        throw new Error('Anda sudah memberikan ulasan untuk appointment ini.');
      }
      throw new Error('Gagal menyimpan ulasan: ' + revErr.message);
    }

    // 3. Kalkulasi dan Update Barber Rating
    const { data: barber } = await supabase
      .from('barbers')
      .select('rating_avg, rating_count')
      .eq('id', apt.barber_id)
      .single();

    if (barber) {
      const oldCount = barber.rating_count || 0;
      const oldAvg = parseFloat(barber.rating_avg?.toString() || '0');
      
      const newCount = oldCount + 1;
      const newAvg = ((oldAvg * oldCount) + payload.rating) / newCount;

      await supabase
        .from('barbers')
        .update({
          rating_count: newCount,
          rating_avg: newAvg.toFixed(2)
        })
        .eq('id', apt.barber_id);
    }

    return review;
  }
}
