import { db } from '../../lib/db';
import { appointments } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { asRpcResult, payTipFromWallet } from '../../db/procedures';

const withStatus = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

export class TipService {
  /**
   * Bayar tip barber dari saldo wallet customer. Debit customer + kredit barber
   * dilakukan atomik via RPC. Saldo customer dicek ulang di server (defense).
   */
  static async payTip(customerId: string, appointmentId: string, amount: number) {
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw withStatus('Jumlah tip tidak valid', 400);
    }

    // Validasi appointment: milik customer, sudah dilayani, punya barber.
    const [apt] = await db
      .select({
        id: appointments.id,
        customer_id: appointments.customerId,
        barber_id: appointments.barberId,
        status: appointments.status
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);

    if (!apt) throw withStatus('Appointment tidak ditemukan', 404);
    if (apt.customer_id !== customerId) throw withStatus('Appointment bukan milik Anda', 403);
    if (!apt.barber_id) throw withStatus('Appointment ini belum memiliki barber', 400);
    if (!['in_service', 'completed'].includes(apt.status)) {
      throw withStatus('Tip hanya bisa diberikan setelah layanan berjalan/selesai', 400);
    }

    const { data: result, error } = await asRpcResult(() =>
      payTipFromWallet({
        customerId,
        barberId: apt.barber_id as string,
        appointmentId,
        amount: amt
      })
    );

    if (error) {
      if (error.code === 'P0001') {
        // Saldo tidak cukup — beri sinyal khusus agar klien mengarahkan ke top-up.
        throw Object.assign(new Error('Saldo tidak mencukupi untuk tip'), {
          status: 400,
          code: 'INSUFFICIENT_BALANCE'
        });
      }
      throw new Error(error.message);
    }

    return {
      amount: amt,
      new_balance: (result as any)?.new_balance ?? null
    };
  }
}
