import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { snakeKeys, toDbDate } from '../../../db/helpers';
import { checkIns, appointments } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { isDuplicateKeyError } from '../../../db/procedures';
import {
  LocationInput,
  RealtimeTrackingService
} from '../../../core/tracking/service';

type CheckInPayload = {
  method: string;
  lat?: number;
  lng?: number;
};

export class TrackingService {
  async startTracking(appointmentId: string, customerId: string, consent: boolean) {
    return RealtimeTrackingService.startSession(appointmentId, customerId, consent);
  }

  async getETA(appointmentId: string, customerId: string) {
    return RealtimeTrackingService.getSnapshot(appointmentId, customerId);
  }

  // Nama method dipertahankan untuk kompatibilitas route lama PATCH /tracking/eta.
  // Semantik yang aman: customer hanya memperbarui lokasi dirinya sendiri dan
  // tidak pernah menulis lokasi/ETA barber.
  async updateETA(
    appointmentId: string,
    customerId: string,
    payload: LocationInput & { eta_minutes?: number }
  ) {
    return RealtimeTrackingService.updateCustomerLocation(
      appointmentId,
      customerId,
      payload
    );
  }

  async checkIn(appointmentId: string, customerId: string, payload: CheckInPayload) {
    const appointment = await RealtimeTrackingService.authorizeParticipant(
      appointmentId,
      { role: 'customer', userId: customerId }
    );

    if (!['confirmed', 'in_queue'].includes(appointment.status)) {
      throw new Error('Check-in hanya dapat dilakukan untuk appointment confirmed atau in_queue');
    }

    const method = payload.method?.trim().toLowerCase();
    if (!['qr', 'qr_code', 'gps', 'geofence'].includes(method)) {
      if (method === 'manual') {
        throw new Error('Metode check-in manual hanya dapat dilakukan oleh staff atau admin');
      }
      throw new Error('Metode check-in tidak valid');
    }

    if ((method === 'gps' || method === 'geofence') && (
      payload.lat === undefined ||
      payload.lng === undefined
    )) {
      throw new Error('Koordinat wajib dikirim untuk check-in GPS/geofence');
    }

    let distanceM: number | null = null;
    if ((method === 'gps' || method === 'geofence') && payload.lat !== undefined && payload.lng !== undefined) {
      distanceM = await RealtimeTrackingService.validateCheckInGeofence(
        appointment.branch_id,
        payload.lat,
        payload.lng
      );
    }

    const [existing] = await db
      .select({ id: checkIns.id })
      .from(checkIns)
      .where(eq(checkIns.appointmentId, appointmentId))
      .limit(1);

    if (existing) {
      throw new Error('Appointment sudah pernah check-in');
    }

    const checkedInAt = new Date();
    const checkInId = randomUUID();
    try {
      await db.insert(checkIns).values({
        id: checkInId,
        appointmentId,
        method,
        locationLat: payload.lat != null ? String(payload.lat) : null,
        locationLng: payload.lng != null ? String(payload.lng) : null,
        checkedInAt: toDbDate(checkedInAt),
        distanceM: distanceM != null ? String(distanceM) : null
      } as any);
    } catch (e: any) {
      if (isDuplicateKeyError(e)) throw new Error('Appointment sudah pernah check-in');
      throw new Error(`Gagal melakukan check-in: ${e?.message || 'unknown'}`);
    }

    const [checkIn] = snakeKeys(await db.select().from(checkIns).where(eq(checkIns.id, checkInId)).limit(1));

    await db
      .update(appointments)
      .set({ checkedInAt: toDbDate(checkedInAt) })
      .where(eq(appointments.id, appointmentId));

    await RealtimeTrackingService.completeSession(appointmentId, 'completed');

    // Check-in tidak mengubah status pesanan (kebijakan: hanya barber yang
    // memasukkan ke antrean), tetapi ia MENGUBAH tahapan yang terlihat —
    // stepper menampilkannya sebagai setengah langkah menuju "Antrean".
    // Tanpa emisi ini, aksi customer sendiri tidak menghasilkan umpan balik.
    const { emitAppointmentStateChanged } = await import('../../../lib/socket');
    await emitAppointmentStateChanged(appointmentId, 'customer:checked_in');

    return checkIn;
  }

  async revokeTracking(appointmentId: string, customerId: string) {
    const appointment = await RealtimeTrackingService.authorizeParticipant(
      appointmentId,
      { role: 'customer', userId: customerId }
    );

    if (['completed', 'cancelled', 'no_show'].includes(appointment.status)) {
      throw new Error('Tracking sudah tidak aktif untuk appointment ini');
    }

    await RealtimeTrackingService.completeSession(appointmentId, 'revoked');
    return { revoked: true };
  }
}
