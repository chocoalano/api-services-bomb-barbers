// ============================================================================
// PENGEMBALIAN DANA ORDER — SATU JALUR UNTUK SEMUA KESALAHAN PENYEDIA
// ----------------------------------------------------------------------------
// Kebijakan: customer TIDAK mendapat pengembalian dana untuk pembatalan atas
// kemauannya sendiri (pembatalan order lunas memang diblokir). Pengembalian
// hanya berlaku ketika kegagalan ada di pihak penyedia:
//   - barber menolak order
//   - barber / worker menandai customer no-show
//   - admin membatalkan order
//
// Sebelumnya logika ini hanya ada di dalam `rejectOrder` dan kegagalannya
// ditelan log. Sekarang terpusat di sini dan dipanggil lewat job ber-retry.
// ============================================================================

import { db } from '../../lib/db';
import { appointments, payments } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { asRpcResult, refundPaymentToWallet } from '../../db/procedures';
import { emitWalletRefundCredited } from '../../lib/socket';
import { logger } from '../../lib/logger';

/**
 * Metode pembayaran yang dananya benar-benar masuk ke sistem sehingga bisa
 * dikembalikan ke dompet. Order tunai tidak pernah menerima uang lewat aplikasi,
 * jadi tidak ada yang perlu dikembalikan.
 */
const ONLINE_PAYMENT_METHODS = ['qris', 'card', 'bank_transfer', 'ewallet'];

export type RefundOutcome = {
  /** true bila dana benar-benar dikreditkan ke dompet pada pemanggilan ini. */
  credited: boolean;
  amount: number;
  /** Alasan tidak ada dana yang dikembalikan (null bila credited). */
  skippedReason: 'no_payment' | 'not_paid' | 'not_online' | 'no_customer' | null;
};

/**
 * Kembalikan dana order ke dompet customer. Idempoten secara praktis:
 * `refundPaymentToWallet` menolak payment yang tidak lagi berstatus
 * `paid`/`partially_refunded`, sehingga pemanggilan kedua tidak menggandakan
 * saldo.
 *
 * Melempar bila proses refund gagal, supaya job pemanggil dapat me-retry.
 */
export const refundAppointmentToWallet = async (
  appointmentId: string,
  opts: { reason: string; processedBy: string | null }
): Promise<RefundOutcome> => {
  const [apt] = await db
    .select({ id: appointments.id, customer_id: appointments.customerId })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (!apt?.customer_id) {
    return { credited: false, amount: 0, skippedReason: 'no_customer' };
  }

  const paymentRows = await db
    .select({
      id: payments.id,
      status: payments.status,
      total_amount: payments.totalAmount,
      method: payments.method
    })
    .from(payments)
    .where(eq(payments.appointmentId, appointmentId));

  if (paymentRows.length === 0) {
    return { credited: false, amount: 0, skippedReason: 'no_payment' };
  }

  // Utamakan baris berstatus 'paid'; attempt gagal yang tersimpan lebih dulu
  // tidak boleh menutupi pembayaran yang berhasil.
  const payment = paymentRows.find((p) => p.status === 'paid');
  if (!payment) {
    return { credited: false, amount: 0, skippedReason: 'not_paid' };
  }
  if (!ONLINE_PAYMENT_METHODS.includes(payment.method ?? '')) {
    return { credited: false, amount: 0, skippedReason: 'not_online' };
  }

  const amount = Number(payment.total_amount);

  const { data: refundResult, error: refundErr } = await asRpcResult(() =>
    refundPaymentToWallet({
      paymentId: payment.id,
      customerId: apt.customer_id as string,
      amount,
      reason: opts.reason,
      processedBy: opts.processedBy
    })
  );

  if (refundErr) {
    // Payment sudah tidak dalam status yang bisa di-refund → anggap sudah
    // dikembalikan sebelumnya, jangan retry selamanya.
    if (refundErr.code === 'P0001') {
      logger.warn(
        { appointmentId, code: refundErr.code },
        '[Refund] Payment tidak lagi bisa di-refund, kemungkinan sudah dikembalikan'
      );
      return { credited: false, amount: 0, skippedReason: 'not_paid' };
    }
    throw new Error(refundErr.message);
  }

  emitWalletRefundCredited({
    customer_id: apt.customer_id,
    appointment_id: appointmentId,
    amount,
    new_balance: refundResult?.new_balance ?? 0
  });

  logger.info({ appointmentId, amount }, '[Refund] Dana dikembalikan ke dompet customer');

  return { credited: true, amount, skippedReason: null };
};
