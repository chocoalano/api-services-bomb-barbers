import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { appointments } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { asRpcResult } from '../../db/procedures';
import { transitionAppointmentStatusAtomic } from '../../db/appointment-procedures';
import { setBarberLiveStatus } from '../booking/presence.service';
import { emitAppointmentStateChanged } from '../../lib/socket';
import { RealtimeTrackingService } from '../tracking/service';

type TransitionMetadata = {
  actor: {
    type: 'customer' | 'staff' | 'system';
    id: string | null;
    role: 'customer' | 'barber' | 'admin' | 'system';
  };
  reason: string;
  event_type?:
    | 'STATUS_TRANSITION'
    | 'ORDER_ACCEPTANCE_TIMEOUT'
    | 'APPOINTMENT_NO_SHOW_TIMEOUT'
    | 'APPOINTMENT_AUTO_COMPLETE_TIMEOUT'
    // [A4] Menghidupkan kembali order yang dibatalkan sistem karena batas bayar.
    | 'PAYMENT_LATE_REVIVAL';
  customer_media_urls?: string[];
  /**
   * Tunda emisi socket ke pemanggil.
   *
   * Dipakai alur yang masih menulis kolom lain SETELAH transisi status (mis.
   * `arrive` yang menyusulkan `journey_status = 'arrived'`). Tanpa ini klien
   * menerima event lebih dulu lalu membaca keadaan yang belum lengkap, dan
   * tidak ada event kedua yang memperbaikinya.
   */
  defer_emit?: boolean;
};

const toLifecycleError = (error: any) => {
  const wrapped = new Error(error?.message || 'Gagal mengubah status appointment') as Error & {
    status?: number;
    code?: string;
  };
  wrapped.code = error?.code;
  wrapped.status = error?.code === '42501'
    ? 403
    : error?.code === 'P0002'
      ? 404
      : error?.code === '40001'
        ? 409
        : 400;
  return wrapped;
};

export class AppointmentLifecycleService {
  static async transition(
    appointmentId: string,
    targetStatus: string,
    metadata: TransitionMetadata
  ) {
    const [current] = snakeKeys(
      await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1)
    );

    if (!current) {
      throw new Error('Appointment tidak ditemukan');
    }

    if (current.status === targetStatus) {
      return current;
    }

    if (!metadata?.actor || !metadata.reason?.trim()) {
      throw new Error('Actor dan reason wajib disertakan pada setiap transisi status');
    }

    const { data: updated, error } = await asRpcResult(() =>
      transitionAppointmentStatusAtomic({
        appointmentId,
        targetStatus,
        expectedVersion: Number(current.version ?? 1),
        actorType: metadata.actor.type,
        actorId: metadata.actor.id,
        actorRole: metadata.actor.role,
        reason: metadata.reason.trim(),
        eventType: metadata.event_type || 'STATUS_TRANSITION',
        customerMediaUrls: metadata.customer_media_urls ?? null
      })
    );

    if (error) {
      throw toLifecycleError(error);
    }
    if (!updated) {
      throw new Error('Status appointment berubah oleh proses lain, muat ulang data terbaru');
    }

    // [E8] Dulu status ini hanya ditulis ke Redis, sedangkan booking membaca DB —
    // barber yang sedang melayani tetap ditawarkan ke customer. Sekarang lewat
    // satu pintu yang menulis DB (otoritas) + Redis (cache).
    if (updated.barber_id) {
      if (targetStatus === 'in_service') {
        await setBarberLiveStatus(updated.barber_id, 'serving');
      } else if (['completed', 'cancelled', 'no_show'].includes(targetStatus)) {
        await setBarberLiveStatus(updated.barber_id, 'available');
      }
    }

    if (['completed', 'cancelled', 'no_show'].includes(targetStatus)) {
      await RealtimeTrackingService.completeSession(
        appointmentId,
        targetStatus === 'completed' ? 'completed' : 'revoked'
      );
    }

    if (!metadata.defer_emit) {
      await emitAppointmentStateChanged(appointmentId, `transition:${targetStatus}`);
    }

    return updated;
  }
}
