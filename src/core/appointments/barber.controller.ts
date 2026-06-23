import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { AppointmentService } from './service';
import { supabase } from '../../lib/supabase';
import { emitBarberLocation } from '../../lib/socket';
import { RealtimeTrackingService } from '../tracking/service';
import { redis, getBarberStatusKey, getTrackingRouteKey, getTrackingCustomerKey } from '../../lib/redis';

const VALID_PRESENCE_STATUSES = ['online', 'offline', 'unavailable'] as const;

async function resolveBarber(staffId: string) {
  const { data: barber } = await supabase.from('barbers').select('id').eq('staff_user_id', staffId).single();
  return barber;
}

async function resolveAppointmentForBarber(appointmentId: string, barberId: string) {
  const { data: apt } = await supabase
    .from('appointments')
    .select('barber_id, status, customer_media_urls, fulfillment_type, appointment_services(id)')
    .eq('id', appointmentId)
    .single();
  if (!apt || apt.barber_id !== barberId) return null;
  return apt;
}

export class BarberAppointmentController {
  static async getMyQueue({ staffId, set }: any) {
    try {
      const queue = await AppointmentService.getBarberDashboardQueue(staffId);
      return createSuccessResponse('Daftar antrean dan order berjalan barber', queue);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async acceptOrder({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat menerima pesanan barber lain'); }
      if (apt.status !== 'pending') {
        set.status = 400; return createErrorResponse('Pesanan hanya bisa diterima jika statusnya pending');
      }

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'confirmed', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: 'Order diterima oleh barber'
      });
      return createSuccessResponse('Order berhasil diterima', {
        ...res,
        status: 'accepted',
        raw_status: res.status
      });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async pushLocation({ params, staffId, set, body }: any) {
    try {
      const tracking = await RealtimeTrackingService.updateBarberLocation(
        params.id,
        staffId,
        body
      );

      emitBarberLocation({
        appointment_id: params.id,
        barber_location: tracking.barber_location,
        // Alias legacy sementara untuk frontend lama.
        barbers_location: {
          lat: tracking.barber_location.lat,
          lng: tracking.barber_location.lng
        },
        customer_location: tracking.customer_location,
        route: tracking.route,
        eta_minutes: tracking.route?.eta_minutes ?? null,
        distance_km: tracking.route?.distance_km ?? null,
        timestamp: tracking.barber_location.received_at
      });

      return createSuccessResponse('Lokasi berhasil diperbarui', tracking);
    } catch (err: any) {
      set.status = err.message.includes('Profil barber') || err.message.includes('Akses')
        ? 403
        : 400;
      return createErrorResponse(err.message);
    }
  }

  static async arriveAtLocation({ params, staffId, set, body }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat update pesanan barber lain'); }
      if (apt.status !== 'confirmed') {
        set.status = 400; return createErrorResponse('Barber hanya bisa menandai tiba jika status order adalah confirmed');
      }

      if ((apt as any).fulfillment_type === 'home_service') {
        if (!body?.lat || !body?.lng) {
          set.status = 400;
          return createErrorResponse('Koordinat GPS wajib dikirim untuk layanan home service');
        }
        await RealtimeTrackingService.validateArriveGeofence(params.id, Number(body.lat), Number(body.lng));
      }

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'in_queue', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: 'Barber menandai sudah tiba di lokasi'
      });
      await RealtimeTrackingService.setJourneyStatus(params.id, 'arrived');
      await RealtimeTrackingService.completeSession(params.id, 'completed');
      return createSuccessResponse('Barber tiba di lokasi', {
        ...res,
        status: 'arrived',
        raw_status: res.status
      });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async rejectOrder({ params, staffId, body, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat menolak pesanan barber lain'); }
      if (apt.status !== 'pending') {
        set.status = 400; return createErrorResponse('Order hanya bisa ditolak jika statusnya pending');
      }

      const reason = (body?.reason ?? '').trim();
      if (!reason) { set.status = 400; return createErrorResponse('Alasan penolakan wajib diisi'); }

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'cancelled', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: `Ditolak barber: ${reason}`
      });
      return createSuccessResponse('Order berhasil ditolak', {
        ...res,
        status: 'rejected',
        raw_status: res.status,
        reject_reason: reason
      });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async markNoShow({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat update pesanan barber lain'); }
      if (!['confirmed', 'in_queue'].includes(apt.status)) {
        set.status = 400;
        return createErrorResponse('No-show hanya bisa dicatat jika status confirmed atau in_queue');
      }

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'no_show', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: 'Customer tidak hadir (dicatat oleh barber)'
      });
      return createSuccessResponse('Customer ditandai tidak hadir', {
        ...res,
        status: 'no_show',
        raw_status: res.status
      });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async setPresenceStatus({ staffId, body, set }: any) {
    try {
      const status = (body?.status ?? '').trim();
      if (!VALID_PRESENCE_STATUSES.includes(status as any)) {
        set.status = 400;
        return createErrorResponse(`Status harus salah satu dari: ${VALID_PRESENCE_STATUSES.join(', ')}`);
      }

      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Profil barber tidak ditemukan'); }

      const { error } = await supabase
        .from('barbers')
        .update({ live_status: status, updated_at: new Date().toISOString() })
        .eq('id', barber.id);
      if (error) throw new Error('Gagal memperbarui status kehadiran: ' + error.message);

      await redis.set(getBarberStatusKey(barber.id), status);

      return createSuccessResponse('Status kehadiran berhasil diperbarui', { status });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async getNavigation({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const { data: apt } = await supabase
        .from('appointments')
        .select('id, status, fulfillment_type, service_address, destination_latitude, destination_longitude, location_notes, customer_media_urls, journey_status')
        .eq('id', params.id)
        .eq('barber_id', barber.id)
        .maybeSingle();

      if (!apt) { set.status = 404; return createErrorResponse('Appointment tidak ditemukan'); }

      let route = null;
      let customerLocation = null;
      try {
        const [routeRaw, customerRaw] = await Promise.all([
          redis.get(getTrackingRouteKey(params.id)),
          redis.get(getTrackingCustomerKey(params.id))
        ]);
        if (routeRaw) route = JSON.parse(routeRaw);
        if (customerRaw) customerLocation = JSON.parse(customerRaw);
      } catch { /* Redis unavailable — return static data */ }

      const destLat = apt.destination_latitude != null && apt.destination_latitude !== 0 ? Number(apt.destination_latitude) : null;
      const destLng = apt.destination_longitude != null && apt.destination_longitude !== 0 ? Number(apt.destination_longitude) : null;

      return createSuccessResponse('Data navigasi appointment', {
        appointment_id: apt.id,
        status: apt.status,
        journey_status: apt.journey_status ?? 'not_started',
        fulfillment_type: apt.fulfillment_type ?? 'in_store',
        destination: destLat !== null && destLng !== null ? { lat: destLat, lng: destLng } : null,
        service_address: apt.service_address ?? null,
        location_notes: apt.location_notes ?? null,
        customer_media_urls: apt.customer_media_urls ?? [],
        route,
        customer_location: customerLocation
      });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async getHistory({ staffId, query, set }: any) {
    try {
      const res = await AppointmentService.getBarberAppointmentHistory(staffId, query ?? {});
      return createSuccessResponse('Riwayat appointment barber', res.data, res.meta);
    } catch (err: any) {
      set.status = err.message.includes('limit') || err.message.includes('page') ? 400 : 500;
      return createErrorResponse(err.message);
    }
  }

  static async getDetail({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const { data: apt } = await supabase
        .from('appointments')
        .select(`
          *,
          appointment_services (id, service_id, price_amount, duration_min,
            services (id, name, image_url)
          ),
          branches (id, name, address, latitude, longitude),
          customers (id, full_name, phone)
        `)
        .eq('id', params.id)
        .eq('barber_id', barber.id)
        .maybeSingle();

      if (!apt) { set.status = 404; return createErrorResponse('Appointment tidak ditemukan'); }
      return createSuccessResponse('Detail appointment', apt);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async getTracking({ params, staffId, set }: any) {
    try {
      const snapshot = await RealtimeTrackingService.getBarberSnapshot(params.id, staffId);
      return createSuccessResponse('Tracking snapshot', snapshot);
    } catch (err: any) {
      set.status = err.message.includes('Akses') || err.message.includes('ditemukan') ? 403 : 400;
      return createErrorResponse(err.message);
    }
  }

  static async startService({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat memulai pesanan barber lain'); }

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'in_service', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: 'Pelayanan dimulai oleh barber'
      });
      return createSuccessResponse('Pelayanan dimulai', res);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async completeService({ params, staffId, set, body }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat menyelesaikan pesanan barber lain'); }

      if (!apt.appointment_services || apt.appointment_services.length === 0) {
        set.status = 400; return createErrorResponse('Tidak bisa menyelesaikan pesanan tanpa layanan');
      }

      if (!body?.before_media_url || !body?.after_media_url) {
        set.status = 400; 
        return createErrorResponse('Foto before dan after wajib diunggah untuk menyelesaikan pesanan dan mencairkan pendapatan.');
      }

      const existingUrls: string[] = (apt as any).customer_media_urls ?? [];
      const newUrls = [body.before_media_url, body.after_media_url];
      const mergedUrls = [...existingUrls, ...newUrls];

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'completed', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: 'Pelayanan diselesaikan oleh barber',
        customer_media_urls: mergedUrls
      });
      return createSuccessResponse('Pelayanan diselesaikan', res);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }
}
