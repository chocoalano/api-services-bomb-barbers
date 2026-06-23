import { supabase } from '../../../lib/supabase';
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

    const { data: existing } = await supabase
      .from('check_ins')
      .select('id')
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (existing) {
      throw new Error('Appointment sudah pernah check-in');
    }

    const checkedInAt = new Date().toISOString();
    const { data: checkIn, error } = await supabase
      .from('check_ins')
      .insert({
        appointment_id: appointmentId,
        method,
        location_lat: payload.lat,
        location_lng: payload.lng,
        checked_in_at: checkedInAt,
        distance_m: distanceM
      })
      .select('*')
      .single();

    if (error || !checkIn) {
      if (error?.code === '23505') {
        throw new Error('Appointment sudah pernah check-in');
      }
      throw new Error(`Gagal melakukan check-in: ${error?.message || 'unknown'}`);
    }

    await supabase
      .from('appointments')
      .update({ checked_in_at: checkedInAt, updated_at: checkedInAt })
      .eq('id', appointmentId);

    await RealtimeTrackingService.completeSession(appointmentId, 'completed');
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
