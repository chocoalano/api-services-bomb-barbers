import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { handleControllerError } from '../../shared/controller-error';
import { AppointmentService } from './service';
import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { barbers, appointments, payments, appointmentServices, services, branches, customers } from '../../db/schema';
import { and, eq } from 'drizzle-orm';
import { settleProviderFaultRefund } from '../../lib/queue';
import { emitBarberLocation } from '../../lib/socket';
import { RealtimeTrackingService } from '../tracking/service';
import { redis, getTrackingRouteKey, getTrackingCustomerKey } from '../../lib/redis';
import { setBarberLiveStatus } from '../booking/presence.service';
import { GatewayFactory } from '../payments/gateways/factory';
import { PaymentService } from '../payments/service';

// [E8] App barber tetap boleh mengirim istilah lamanya (kompatibilitas versi
// lama yang sudah terpasang di HP barber); nilainya dinormalkan ke kamus
// kanonik oleh `setBarberLiveStatus` sebelum disimpan.
const VALID_PRESENCE_STATUSES = [
  'online', 'offline', 'unavailable',
  'available', 'on_break'
] as const;

/**
 * [A6] Order ONLINE hanya boleh diterima bila pembayarannya sudah lunas.
 *
 * Filter visibilitas antrean saja tidak cukup — barber yang memegang
 * `appointment_id` tetap dapat memanggil endpoint accept secara langsung.
 * Order walk-in (dicatat admin di lokasi) tidak terpengaruh.
 */
async function isOnlineOrderUnpaid(appointmentId: string, source: string | null) {
  if (source !== 'online_booking') return false;
  const rows = await db
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.appointmentId, appointmentId));
  return !rows.some((p) => p.status === 'paid');
}

async function resolveBarber(staffId: string) {
  const [barber] = await db.select({ id: barbers.id }).from(barbers).where(eq(barbers.staffUserId, staffId)).limit(1);
  return barber ?? null;
}

async function resolveAppointmentForBarber(appointmentId: string, barberId: string) {
  const [apt] = snakeKeys(
    await db
      .select({
        barber_id: appointments.barberId,
        customer_id: appointments.customerId,
        branch_id: appointments.branchId,
        status: appointments.status,
        source: appointments.source,
        scheduled_at: appointments.scheduledAt,
        journey_status: appointments.journeyStatus,
        customer_media_urls: appointments.customerMediaUrls,
        fulfillment_type: appointments.fulfillmentType
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1)
  );
  if (!apt || apt.barber_id !== barberId) return null;
  const svc = await db
    .select({ id: appointmentServices.id })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appointmentId));
  apt.appointment_services = svc;
  return apt;
}

export class BarberAppointmentController {
  static async getMyQueue({ staffId, set }: any) {
    try {
      const queue = await AppointmentService.getBarberDashboardQueue(staffId);
      return createSuccessResponse('Daftar antrean dan order berjalan barber', queue);
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.getMyQueue', { detail: false });
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

      if (await isOnlineOrderUnpaid(params.id, apt.source ?? null)) {
        set.status = 400;
        return createErrorResponse(
          'Pesanan online hanya dapat diterima setelah pembayarannya lunas',
          null,
          'ORDER_NOT_PAID'
        );
      }

      // [REVISI B8] Tolak jika kepster sudah melampaui kuota harian (order ini dikecualikan).
      if (apt.scheduled_at) {
        await AppointmentService.assertBarberDailyQuota(barber.id, apt.scheduled_at, params.id);
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
      return handleControllerError(err, set, 'barber.acceptOrder', { detail: false });
    }
  }

  /**
   * Barber memverifikasi status pembayaran ke Midtrans — TANPA menerima order.
   * Setelah endpoint ini sukses, barber bisa memilih terima (/accept) atau tolak (/reject).
   *
   * - Cash / tidak ada payment → langsung return payment_status: 'cash'
   * - Sudah paid di DB → return payment_status: 'paid' (tidak ada aksi)
   * - Belum paid, ada gateway_reference → cek Midtrans → jika settlement → tandai paid
   * - Belum paid, tidak ada gateway_reference → error (pelanggan belum bayar)
   */
  static async verifyPaymentOnly({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat mengakses pesanan barber lain'); }
      if (apt.status !== 'pending') {
        set.status = 400;
        return createErrorResponse('Pengecekan pembayaran hanya berlaku untuk pesanan dengan status pending');
      }

      const [payment] = await db
        .select({ id: payments.id, status: payments.status, method: payments.method, gateway_reference: payments.gatewayReference, total_amount: payments.totalAmount })
        .from(payments)
        .where(eq(payments.appointmentId, params.id))
        .limit(1);

      const onlinePaymentMethods = ['qris', 'card', 'bank_transfer', 'ewallet'];
      const isOnlinePayment = payment && onlinePaymentMethods.includes(payment.method ?? '');

      // Cash atau tidak ada payment → tidak perlu verifikasi
      if (!isOnlinePayment) {
        return createSuccessResponse('Order ini menggunakan pembayaran tunai, tidak perlu verifikasi', {
          payment_status: 'cash',
          needs_verify: false
        });
      }

      // Sudah paid di DB → tidak perlu ke Midtrans lagi
      if (payment.status === 'paid') {
        return createSuccessResponse('Pembayaran sudah terkonfirmasi', {
          payment_status: 'paid',
          needs_verify: false
        });
      }

      // Pelanggan belum memulai transaksi
      if (!payment.gateway_reference) {
        set.status = 400;
        return createErrorResponse('Pelanggan belum menyelesaikan pembayaran. Minta pelanggan untuk membuka aplikasi dan melakukan pembayaran terlebih dahulu.');
      }

      // Cek ke Midtrans
      const gateway = GatewayFactory.getGateway('midtrans');
      if (!gateway.checkTransactionStatus) {
        set.status = 500;
        return createErrorResponse('Gateway tidak mendukung verifikasi status transaksi');
      }

      const statusData = await gateway.checkTransactionStatus(payment.gateway_reference);
      const paidStatuses = ['settlement', 'capture'];

      if (!paidStatuses.includes(statusData.transaction_status)) {
        set.status = 400;
        return createErrorResponse(
          `Pembayaran belum selesai di Midtrans (status: ${statusData.transaction_status}). Minta pelanggan menyelesaikan pembayaran.`
        );
      }

      // Midtrans mengkonfirmasi → tandai paid di DB, tapi JANGAN accept order
      await PaymentService.updatePaymentStatus(payment.id, 'paid', staffId, 'staff');

      return createSuccessResponse('Pembayaran terkonfirmasi. Silakan terima atau tolak order.', {
        payment_status: 'paid',
        needs_verify: false
      });
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.verifyPaymentOnly', { detail: false });
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
      const status = err.message?.includes('Profil barber') || err.message?.includes('Akses') ? 403 : 400;
      return handleControllerError(err, set, 'barber.pushLocation', { status, detail: false });
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

      // Urutan penting: `journey_status` ditulis LEBIH DULU dan emisi transisi
      // ditunda, sehingga klien menerima TEPAT SATU event yang sudah memuat
      // keadaan lengkap. Sebelumnya transisi menyiarkan duluan lalu journey
      // menyusul, dan klien yang menambal saat event tiba membaca 'en_route'
      // yang sudah basi tanpa pernah menerima koreksi.
      await RealtimeTrackingService.setJourneyStatus(params.id, 'arrived', { emitEvent: false });
      const res = await AppointmentService.updateAppointmentStatus(params.id, 'in_queue', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: 'Barber menandai sudah tiba di lokasi'
      });
      await RealtimeTrackingService.completeSession(params.id, 'completed');
      return createSuccessResponse('Barber tiba di lokasi', {
        ...res,
        status: 'arrived',
        raw_status: res.status
      });
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.arriveAtLocation', { detail: false });
    }
  }

  /**
   * Barber menekan "Menuju Lokasi". Menandai barber sedang dalam perjalanan
   * (journey_status = 'en_route') dan memberi tahu customer secara realtime.
   *
   * Gerbang waktu (§workflow): hanya boleh dimulai maksimal 1 jam sebelum jadwal
   * booking. Perbandingan memakai instan absolut (timestamptz), setara dengan
   * evaluasi di zona Asia/Jakarta. Validasi ini WAJIB di backend, tidak boleh
   * hanya mengandalkan frontend.
   */
  static async departToLocation({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const apt = await resolveAppointmentForBarber(params.id, barber.id);
      if (!apt) { set.status = 403; return createErrorResponse('Tidak dapat memulai perjalanan untuk pesanan barber lain'); }
      if (apt.status !== 'confirmed') {
        set.status = 400; return createErrorResponse('Barber hanya bisa menuju lokasi jika status order adalah confirmed');
      }
      if (!apt.scheduled_at) {
        set.status = 400; return createErrorResponse('Jadwal booking tidak tersedia untuk pesanan ini.');
      }

      const trackingAvailableAtMs = new Date(apt.scheduled_at).getTime() - 60 * 60 * 1000;
      if (Date.now() < trackingAvailableAtMs) {
        set.status = 400;
        return createErrorResponse('Order baru dapat dimulai 1 jam sebelum waktu booking.');
      }

      // `setJourneyStatus` sendiri yang menyiarkan keadaan baru (satu pintu),
      // termasuk tahapan kanonik "Menuju Lokasi" untuk stepper customer.
      await RealtimeTrackingService.setJourneyStatus(params.id, 'en_route');

      return createSuccessResponse('Barber menuju lokasi customer', {
        journey_status: 'en_route',
        status: 'on_the_way',
        raw_status: apt.status
      });
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.departToLocation', { detail: false });
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

      // Batalkan appointment
      const res = await AppointmentService.updateAppointmentStatus(params.id, 'cancelled', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: `Ditolak barber: ${reason}`
      });

      // Pengembalian dana dijalankan lewat helper bersama + job ber-retry.
      // Sebelumnya kegagalan refund hanya di-log dan hilang; sekarang percobaan
      // pertama dilakukan langsung (agar respons dapat melaporkan hasilnya) dan
      // kegagalannya dilempar ke antrean untuk dicoba ulang.
      const refund = await settleProviderFaultRefund(params.id, {
        reason: `Refund order ditolak barber - ${reason}`,
        processedBy: staffId
      });

      return createSuccessResponse('Order berhasil ditolak', {
        ...res,
        status: 'rejected',
        raw_status: res.status,
        reject_reason: reason,
        refund_amount: refund.amount,
        wallet_credited: refund.credited
      });
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.rejectOrder', { detail: false });
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

      // Gerbang waktu: no-show tidak masuk akal sebelum jadwalnya tiba. Tanpa ini
      // barber dapat mematikan booking besok yang sudah dibayar hanya dengan satu
      // tekan, dan status no_show tidak punya jalan kembali.
      if (apt.scheduled_at && new Date(apt.scheduled_at).getTime() > Date.now()) {
        set.status = 400;
        return createErrorResponse(
          'No-show baru dapat dicatat setelah waktu jadwal terlewat',
          null,
          'NO_SHOW_TOO_EARLY'
        );
      }

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'no_show', {
        actor: { type: 'staff', id: staffId, role: 'barber' },
        reason: 'Customer tidak hadir (dicatat oleh barber)'
      });

      // Kesalahan penyedia vs customer memang abu-abu di sini, tetapi order sudah
      // dibayar dan layanan tidak diberikan — dana dikembalikan ke dompet agar
      // tidak ada uang tertahan tanpa layanan.
      const refund = await settleProviderFaultRefund(params.id, {
        reason: 'Refund order ditandai no-show',
        processedBy: staffId
      });

      return createSuccessResponse('Customer ditandai tidak hadir', {
        ...res,
        status: 'no_show',
        raw_status: res.status,
        refund_amount: refund.amount,
        wallet_credited: refund.credited
      });
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.markNoShow', { detail: false });
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

      // [E8] Satu pintu tulis: DB (otoritas) + Redis (cache), sudah dinormalkan.
      const canonical = await setBarberLiveStatus(barber.id, status);

      return createSuccessResponse('Status kehadiran berhasil diperbarui', { status: canonical });
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.setPresenceStatus', { detail: false });
    }
  }

  static async getNavigation({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const [apt] = snakeKeys(
        await db
          .select({
            id: appointments.id,
            status: appointments.status,
            fulfillment_type: appointments.fulfillmentType,
            service_address: appointments.serviceAddress,
            destination_latitude: appointments.destinationLatitude,
            destination_longitude: appointments.destinationLongitude,
            location_notes: appointments.locationNotes,
            customer_media_urls: appointments.customerMediaUrls,
            journey_status: appointments.journeyStatus
          })
          .from(appointments)
          .where(and(eq(appointments.id, params.id), eq(appointments.barberId, barber.id)))
          .limit(1)
      );

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
      return handleControllerError(err, set, 'barber.getNavigation', { detail: false });
    }
  }

  static async getHistory({ staffId, query, set }: any) {
    try {
      const res = await AppointmentService.getBarberAppointmentHistory(staffId, query ?? {});
      return createSuccessResponse('Riwayat appointment barber', res.data, res.meta);
    } catch (err: any) {
      const status = err.message?.includes('limit') || err.message?.includes('page') ? 400 : 500;
      return handleControllerError(err, set, 'barber.getHistory', { status, detail: false });
    }
  }

  static async getDetail({ params, staffId, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Hanya barber yang dapat melakukan ini'); }

      const [row] = await db
        .select({ appt: appointments, branchId: branches.id, branchName: branches.name, branchAddress: branches.address, branchLat: branches.latitude, branchLng: branches.longitude, custId: customers.id, custFullName: customers.fullName, custPhone: customers.phone })
        .from(appointments)
        .leftJoin(branches, eq(appointments.branchId, branches.id))
        .leftJoin(customers, eq(appointments.customerId, customers.id))
        .where(and(eq(appointments.id, params.id), eq(appointments.barberId, barber.id)))
        .limit(1);

      if (!row) { set.status = 404; return createErrorResponse('Appointment tidak ditemukan'); }

      const svcRows = await db
        .select({
          id: appointmentServices.id,
          service_id: appointmentServices.serviceId,
          price_amount: appointmentServices.priceAmount,
          duration_min: appointmentServices.durationMin,
          serviceName: services.name,
          serviceImageUrl: services.imageUrl,
          serviceIdRef: services.id
        })
        .from(appointmentServices)
        .leftJoin(services, eq(appointmentServices.serviceId, services.id))
        .where(eq(appointmentServices.appointmentId, params.id));

      const apt = {
        ...snakeKeys(row.appt),
        appointment_services: svcRows.map((s) => ({
          id: s.id,
          service_id: s.service_id,
          price_amount: s.price_amount,
          duration_min: s.duration_min,
          services: s.serviceIdRef ? { id: s.serviceIdRef, name: s.serviceName, image_url: s.serviceImageUrl } : null
        })),
        branches: row.branchId ? { id: row.branchId, name: row.branchName, address: row.branchAddress, latitude: row.branchLat, longitude: row.branchLng } : null,
        customers: row.custId ? { id: row.custId, full_name: row.custFullName, phone: row.custPhone } : null
      };

      return createSuccessResponse('Detail appointment', apt);
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.getDetail', { detail: false });
    }
  }

  static async getTracking({ params, staffId, set }: any) {
    try {
      const snapshot = await RealtimeTrackingService.getBarberSnapshot(params.id, staffId);
      return createSuccessResponse('Tracking snapshot', snapshot);
    } catch (err: any) {
      const status = err.message?.includes('Akses') || err.message?.includes('ditemukan') ? 403 : 400;
      return handleControllerError(err, set, 'barber.getTracking', { status, detail: false });
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

      // [REVISI A11] Penyelesaian order tetap manual & LANGSUNG saat kepster
      // menekan "Layanan Selesai" (pendapatan tak tertunda). Grace 30 menit
      // "auto-done" hanya soal tampilan di sisi customer (order completed tetap
      // terlihat 30 menit sebelum pindah ke Riwayat), ditangani di app customer.

      return createSuccessResponse('Pelayanan dimulai', res);
    } catch (err: any) {
      return handleControllerError(err, set, 'barber.startService', { detail: false });
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
      return handleControllerError(err, set, 'barber.completeService', { detail: false });
    }
  }
}
