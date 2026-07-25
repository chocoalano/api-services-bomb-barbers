// ============================================================================
// PEMBAYARAN TERLAMBAT ATAS ORDER YANG SUDAH DIBATALKAN  [temuan A4]
// ----------------------------------------------------------------------------
// Customer membayar di menit terakhir, pembatalan otomatis berjalan lebih dulu,
// lalu webhook gateway tiba beberapa menit kemudian. Dana sudah tertagih tetapi
// ordernya sudah mati. Sebelumnya webhook menandai `paid` tanpa peduli status
// appointment sama sekali.
//
// Kebijakan (E2): COBA HIDUPKAN KEMBALI ordernya; kembalikan dana hanya bila
// tidak layak dihidupkan. Dengan begitu customer tidak kehilangan slotnya hanya
// karena selisih beberapa menit.
//
// Pertahanan berlapis: `PaymentService.reconcilePendingPaymentFromGateway`
// mencegah mayoritas kasus ini terjadi sejak awal (menanyakan status ke gateway
// SEBELUM membatalkan). Modul ini menangani sisanya.
// ============================================================================

import { db } from '../../lib/db';
import { appointments, appointmentEvents } from '../../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { AppointmentService } from './service';
import { emitNewOrder, emitAppointmentStateChanged } from '../../lib/socket';
import { logger } from '../../lib/logger';

/**
 * Order hanya dihidupkan bila jadwalnya masih cukup jauh. Menghidupkan order
 * yang jam layanannya tinggal beberapa menit lagi hanya memindahkan masalah ke
 * barber.
 */
export const REVIVAL_MIN_LEAD_MINUTES = 30;

export type RevivalOutcome =
  | { action: 'revived'; barberId: string | null }
  | { action: 'not_eligible'; reason: string };

/** Apakah order ini dibatalkan oleh SISTEM karena batas waktu pembayaran? */
const wasCancelledByPaymentTimeout = async (appointmentId: string) => {
  const [event] = await db
    .select({ event_type: appointmentEvents.eventType, to_status: appointmentEvents.toStatus })
    .from(appointmentEvents)
    .where(eq(appointmentEvents.appointmentId, appointmentId))
    .orderBy(desc(appointmentEvents.createdAt))
    .limit(1);

  // Pembatalan oleh customer maupun admin TIDAK boleh dihidupkan kembali —
  // keduanya keputusan manusia, bukan efek samping tenggat.
  return event?.to_status === 'cancelled' && event?.event_type === 'ORDER_ACCEPTANCE_TIMEOUT';
};

/**
 * Coba hidupkan kembali order yang dibatalkan sistem, setelah pembayarannya
 * ternyata masuk. Mengembalikan `not_eligible` (tanpa melempar) bila tidak
 * memenuhi syarat — pemanggil lalu menempuh jalur refund.
 */
export const revivePaidCancelledOrder = async (
  appointmentId: string
): Promise<RevivalOutcome> => {
  const [apt] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      source: appointments.source,
      branch_id: appointments.branchId,
      barber_id: appointments.barberId,
      scheduled_at: appointments.scheduledAt
    })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (!apt) return { action: 'not_eligible', reason: 'appointment_not_found' };
  if (apt.status !== 'cancelled') return { action: 'not_eligible', reason: 'not_cancelled' };
  if (apt.source !== 'online_booking') return { action: 'not_eligible', reason: 'not_online_booking' };
  if (!apt.scheduled_at) return { action: 'not_eligible', reason: 'no_schedule' };

  if (!(await wasCancelledByPaymentTimeout(appointmentId))) {
    return { action: 'not_eligible', reason: 'not_cancelled_by_timeout' };
  }

  const scheduledAt = new Date(apt.scheduled_at);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { action: 'not_eligible', reason: 'invalid_schedule' };
  }
  const minutesUntil = (scheduledAt.getTime() - Date.now()) / 60_000;
  if (minutesUntil < REVIVAL_MIN_LEAD_MINUTES) {
    return { action: 'not_eligible', reason: 'schedule_too_close' };
  }

  // Jam operasional TIDAK diperiksa ulang: `scheduled_at` tidak berubah sejak
  // order dibuat dan sudah lolos validasi saat itu.
  //
  // Jeda minimal pemesanan juga TIDAK diperiksa — aturan itu untuk pemesanan
  // BARU, sedangkan ini pemulihan pesanan lama. Jangan "perbaiki" ini kemudian
  // hari tanpa memahami bedanya.

  // Barber semula diutamakan; bila slotnya sudah terisi order lain, cari pengganti.
  let barberId: string | null = apt.barber_id ?? null;
  const originalStillFree =
    barberId != null
    && (await AppointmentService.isBarberFreeForSlot(barberId, apt.scheduled_at, appointmentId));

  if (!originalStillFree) {
    try {
      barberId = await AppointmentService.pickReplacementBarber(
        apt.branch_id,
        apt.scheduled_at,
        barberId ? [barberId] : [],
        { appointmentId }
      );
    } catch {
      return { action: 'not_eligible', reason: 'no_barber_available' };
    }
  }

  await AppointmentService.updateAppointmentStatus(appointmentId, 'pending', {
    actor: { type: 'system', id: null, role: 'system' },
    event_type: 'PAYMENT_LATE_REVIVAL',
    reason: 'Dihidupkan kembali: pembayaran diterima setelah pembatalan otomatis'
  });

  if (barberId && barberId !== apt.barber_id) {
    await db
      .update(appointments)
      .set({ barberId })
      .where(eq(appointments.id, appointmentId));

    // Barber pengganti mengubah kartu yang dilihat customer (nama, rating,
    // lokasi awal). Transisi status di atas sudah menyiarkan keadaan lama,
    // jadi siarkan sekali lagi setelah barber benar-benar berganti.
    await emitAppointmentStateChanged(appointmentId, 'revival:barber_reassigned', {
      alsoNotifyBarberIds: apt.barber_id ? [apt.barber_id] : []
    });
  }

  if (barberId) {
    emitNewOrder(barberId, {
      appointment_id: appointmentId,
      timestamp: new Date().toISOString()
    });
  }

  logger.info(
    { appointmentId, barberId, minutesUntil: Math.round(minutesUntil) },
    '[Revival] Order dihidupkan kembali setelah pembayaran terlambat'
  );

  return { action: 'revived', barberId };
};
