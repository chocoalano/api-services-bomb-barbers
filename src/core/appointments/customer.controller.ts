import { createSuccessResponse } from '../../shared/response';
import { handleControllerError } from '../../shared/controller-error';
import { AppointmentService } from './service';
import { db } from '../../lib/db';
import { appointments } from '../../db/schema';
import { eq } from 'drizzle-orm';

async function findAppointmentOwnership(id: string) {
  const [row] = await db
    .select({ status: appointments.status, customer_id: appointments.customerId })
    .from(appointments)
    .where(eq(appointments.id, id))
    .limit(1);
  return row ?? null;
}

export class CustomerAppointmentController {
  static async createOnlineBooking({ body, customerId, headers, set }: any) {
    try {
      const payload = {
        ...body,
        customer_id: customerId,
        idempotency_key: headers['idempotency-key']
      };
      const apt = await AppointmentService.createAppointment(
        payload,
        'online_booking',
        { type: 'customer', id: customerId, role: 'customer' }
      );
      set.status = 201;
      return createSuccessResponse('Pemesanan online berhasil dibuat', apt);
    } catch (err: any) {
      return handleControllerError(err, set, 'customer.createOnlineBooking');
    }
  }

  static async getMyAppointments({ customerId, query, set }: any) {
    try {
      const apts = await AppointmentService.getCustomerAppointments(customerId, query);
      return createSuccessResponse('Daftar riwayat pemesanan', apts);
    } catch (err: any) {
      return handleControllerError(err, set, 'customer.getMyAppointments', { status: 400, detail: false });
    }
  }

  static async getAppointmentDetail({ params, customerId, set }: any) {
    try {
      const appointment = await AppointmentService.getCustomerAppointmentDetail(customerId, params.id);
      return createSuccessResponse('Detail pemesanan', appointment);
    } catch (err: any) {
      return handleControllerError(err, set, 'customer.getAppointmentDetail', { status: 404, detail: false });
    }
  }

  static async cancelAppointment({ params, body, customerId, set }: any) {
    try {
      // Pastikan milik customer ini dan belum in_service
      const data = await findAppointmentOwnership(params.id);
      if (!data || data.customer_id !== customerId) throw new Error('Pemesanan tidak valid');
      if (['in_service', 'completed', 'cancelled', 'no_show'].includes(data.status)) {
        throw new Error(`Tidak dapat membatalkan pemesanan dengan status ${data.status}`);
      }

      const res = await AppointmentService.updateAppointmentStatus(params.id, 'cancelled', {
        actor: { type: 'customer', id: customerId, role: 'customer' },
        reason: body.reason
      });
      return createSuccessResponse('Pemesanan berhasil dibatalkan', res);
    } catch (err: any) {
      return handleControllerError(err, set, 'customer.cancelAppointment');
    }
  }

  static async updateDestination({ params, body, customerId, set }: any) {
    try {
      const apt = await AppointmentService.updateDestination(
        params.id,
        customerId,
        body?.destination_latitude,
        body?.destination_longitude
      );
      return createSuccessResponse('Lokasi tujuan berhasil diperbarui', apt);
    } catch (err: any) {
      return handleControllerError(err, set, 'customer.updateDestination');
    }
  }

  // [REVISI A8] Ubah order sebelum bayar — hanya tanggal/jam, lokasi, catatan.
  static async updateOrder({ params, body, customerId, set }: any) {
    try {
      const apt = await AppointmentService.updateBeforePayment(customerId, params.id, {
        scheduled_at: body?.scheduled_at,
        service_address: body?.service_address,
        destination_latitude: body?.destination_latitude,
        destination_longitude: body?.destination_longitude,
        location_notes: body?.location_notes
      });
      return createSuccessResponse('Order berhasil diperbarui', apt);
    } catch (err: any) {
      return handleControllerError(err, set, 'customer.updateOrder');
    }
  }

  static async updateStatus({ params, body, customerId, set }: any) {
    try {
      if (body.status !== 'cancelled') {
        throw new Error('Customer hanya dapat membatalkan appointment');
      }

      // Pastikan milik customer ini
      const data = await findAppointmentOwnership(params.id);
      if (!data || data.customer_id !== customerId) throw new Error('Pemesanan tidak valid atau bukan milik Anda');

      const apt = await AppointmentService.updateAppointmentStatus(params.id, body.status, {
        actor: { type: 'customer', id: customerId, role: 'customer' },
        reason: body.cancellation_reason || 'Appointment dibatalkan oleh customer'
      });
      return createSuccessResponse('Status pemesanan berhasil diperbarui', apt);
    } catch (err: any) {
      return handleControllerError(err, set, 'customer.updateStatus', { detail: false });
    }
  }
}
