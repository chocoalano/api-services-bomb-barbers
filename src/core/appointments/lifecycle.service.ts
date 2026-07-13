import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { appointments } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { asRpcResult } from '../../db/procedures';
import { transitionAppointmentStatusAtomic } from '../../db/appointment-procedures';
import { getBarberStatusKey, redis } from '../../lib/redis';
import { emitAppointmentStatusChanged } from '../../lib/socket';
import { RealtimeTrackingService } from '../tracking/service';

const STATUS_ALIASES: Record<string, string> = {
  pending: 'pending',
  confirmed: 'accepted',
  in_queue: 'arrived',
  in_service: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show'
};

type TransitionMetadata = {
  actor: {
    type: 'customer' | 'staff' | 'system';
    id: string | null;
    role: 'customer' | 'barber' | 'admin' | 'system';
  };
  reason: string;
  event_type?: 'STATUS_TRANSITION' | 'ORDER_ACCEPTANCE_TIMEOUT' | 'APPOINTMENT_NO_SHOW_TIMEOUT' | 'APPOINTMENT_AUTO_COMPLETE_TIMEOUT';
  customer_media_urls?: string[];
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

    if (updated.barber_id) {
      if (targetStatus === 'in_service') {
        await redis.set(getBarberStatusKey(updated.barber_id), 'serving');
      } else if (['completed', 'cancelled', 'no_show'].includes(targetStatus)) {
        await redis.set(getBarberStatusKey(updated.barber_id), 'available');
      }
    }

    if (['completed', 'cancelled', 'no_show'].includes(targetStatus)) {
      await RealtimeTrackingService.completeSession(
        appointmentId,
        targetStatus === 'completed' ? 'completed' : 'revoked'
      );
    }

    emitAppointmentStatusChanged({
      appointment_id: appointmentId,
      status: STATUS_ALIASES[targetStatus] || targetStatus,
      raw_status: targetStatus,
      barber_id: updated.barber_id ?? null,
      customer_id: updated.customer_id ?? null,
      branch_id: updated.branch_id ?? null,
      timestamp: new Date().toISOString()
    });

    return updated;
  }
}
