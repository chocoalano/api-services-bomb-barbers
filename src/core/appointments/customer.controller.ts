import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { AppointmentService } from './service';
import { supabase } from '../../lib/supabase';

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
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async getMyAppointments({ customerId, query, set }: any) {
    try {
      const apts = await AppointmentService.getCustomerAppointments(customerId, query);
      return createSuccessResponse('Daftar riwayat pemesanan', apts);
    } catch (err: any) {
      set.status = 400;
      return createErrorResponse(err.message);
    }
  }

  static async getAppointmentDetail({ params, customerId, set }: any) {
    try {
      const appointment = await AppointmentService.getCustomerAppointmentDetail(customerId, params.id);
      return createSuccessResponse('Detail pemesanan', appointment);
    } catch (err: any) {
      set.status = 404;
      return createErrorResponse(err.message);
    }
  }

  static async cancelAppointment({ params, body, customerId, set }: any) {
    try {
      // Pastikan milik customer ini dan belum in_service
      const { data } = await supabase.from('appointments').select('status, customer_id').eq('id', params.id).single();
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
      set.status = err.status || 400;
      return createErrorResponse(err.message);
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
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async updateStatus({ params, body, customerId, set }: any) {
    try {
      if (body.status !== 'cancelled') {
        throw new Error('Customer hanya dapat membatalkan appointment');
      }

      // Pastikan milik customer ini
      const { data } = await supabase.from('appointments').select('status, customer_id').eq('id', params.id).single();
      if (!data || data.customer_id !== customerId) throw new Error('Pemesanan tidak valid atau bukan milik Anda');

      const apt = await AppointmentService.updateAppointmentStatus(params.id, body.status, {
        actor: { type: 'customer', id: customerId, role: 'customer' },
        reason: body.cancellation_reason || 'Appointment dibatalkan oleh customer'
      });
      return createSuccessResponse('Status pemesanan berhasil diperbarui', apt);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }
}
