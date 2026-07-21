import { createSuccessResponse } from '../../shared/response';
import { handleControllerError } from '../../shared/controller-error';
import { AppointmentService } from './service';
import { db } from '../../lib/db';
import { appointments, payments } from '../../db/schema';
import { and, eq } from 'drizzle-orm';

async function findAppointmentOwnership(id: string) {
  const [row] = await db
    .select({ status: appointments.status, customer_id: appointments.customerId })
    .from(appointments)
    .where(eq(appointments.id, id))
    .limit(1);
  return row ?? null;
}

/** true bila order punya minimal satu baris pembayaran berstatus `paid`. */
async function hasPaidPayment(appointmentId: string) {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.appointmentId, appointmentId), eq(payments.status, 'paid')))
    .limit(1);
  return Boolean(row);
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

      // [KEBIJAKAN] Pesanan yang SUDAH DIBAYAR tidak dapat dibatalkan sendiri oleh
      // customer — tidak ada pengembalian dana untuk pembatalan atas kemauan
      // sendiri, sehingga membolehkannya hanya akan membuat uang hangus diam-diam.
      // Perubahan pada pesanan berbayar ditangani admin.
      if (await hasPaidPayment(params.id)) {
        const err = new Error(
          'Pesanan yang sudah dibayar tidak dapat dibatalkan. Silakan hubungi admin untuk bantuan.'
        ) as Error & { status?: number; code?: string };
        err.status = 400;
        err.code = 'PAID_ORDER_NOT_CANCELLABLE';
        throw err;
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

  // [KEBIJAKAN] Perubahan order oleh customer DIHAPUS seluruhnya — termasuk untuk
  // order yang belum dibayar. Salah pilih sebelum bayar → batalkan lalu pesan
  // ulang; sudah dibayar → hubungi admin. Aturannya sengaja hanya satu kalimat
  // agar tidak ada jalur setengah jadi yang bisa gagal (mis. reschedule yang
  // tertolak aturan jeda minimal pemesanan).

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
