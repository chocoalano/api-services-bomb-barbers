import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { AppointmentService } from './service';
import { supabase } from '../../lib/supabase';
import { AuditService } from '../../modules/admin/audit/service';
import { emitNewOrder } from '../../lib/socket';

export class AdminAppointmentController {
  static async createWalkIn({ params, body, staffId, headers, set }: any) {
    try {
      // Application-level guard: barber_id (if provided) must belong to the target branch.
      // This prevents cross-branch assignment before the request even reaches the DB RPC.
      if (body?.barber_id) {
        const { data: barber } = await supabase
          .from('barbers')
          .select('branch_id')
          .eq('id', body.barber_id)
          .is('deleted_at', null)
          .maybeSingle();
        if (!barber) {
          set.status = 400;
          return createErrorResponse('Barber tidak ditemukan');
        }
        if (barber.branch_id !== params.branchId) {
          set.status = 400;
          return createErrorResponse('Barber tidak terdaftar pada cabang ini');
        }
      }

      const payload = {
        ...body,
        branch_id: params.branchId,
        idempotency_key: headers['idempotency-key']
      };
      const apt = await AppointmentService.createAppointment(
        payload,
        'walk_in',
        { type: 'staff', id: staffId, role: 'admin' }
      );
      set.status = 201;
      return createSuccessResponse('Walk-in berhasil dicatat', apt);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async getBranchQueue({ params, set }: any) {
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, barbers (display_name), customers(full_name)')
        .eq('branch_id', params.branchId)
        .in('status', ['pending', 'confirmed', 'in_queue', 'in_service'])
        .order('queue_position', { ascending: true });

      if (error) throw new Error(error.message);
      return createSuccessResponse('Daftar antrean cabang', data);
    } catch (err: any) {
      set.status = 400;
      return createErrorResponse(err.message);
    }
  }

  static async updateStatus({ params, body, staffId, set }: any) {
    try {
      const apt = await AppointmentService.updateAppointmentStatus(params.id, body.status, {
        actor: { type: 'staff', id: staffId, role: 'admin' },
        reason:
          body.reason
          || body.cancellation_reason
          || `Status diubah menjadi ${body.status} oleh admin`
      });
      return createSuccessResponse('Status berhasil diperbarui', apt);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async updateDestination({ params, body, staffId, set }: any) {
    try {
      const { apt, before } = await AppointmentService.updateDestinationAdmin(
        params.id,
        body?.destination_latitude,
        body?.destination_longitude
      );

      await AuditService.logAction(
        'admin', staffId, 'UPDATE_DESTINATION', 'appointments', params.id,
        before,
        { destination_latitude: apt.destination_latitude, destination_longitude: apt.destination_longitude },
        apt.branch_id
      );

      return createSuccessResponse('Lokasi tujuan berhasil diperbarui', apt);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async reassignBarber({ params, body, staffId, set }: any) {
    try {
      const { data: apt } = await supabase
        .from('appointments')
        .select('id, branch_id, barber_id, status, customer_id')
        .eq('id', params.id)
        .maybeSingle();

      if (!apt) {
        set.status = 404;
        return createErrorResponse('Appointment tidak ditemukan');
      }

      if (['completed', 'cancelled', 'no_show'].includes(apt.status)) {
        set.status = 400;
        return createErrorResponse('Tidak dapat reassign barber pada appointment yang sudah selesai/dibatalkan');
      }

      const { data: newBarber } = await supabase
        .from('barbers')
        .select('id, branch_id, display_name')
        .eq('id', body.barber_id)
        .is('deleted_at', null)
        .maybeSingle();

      if (!newBarber) {
        set.status = 400;
        return createErrorResponse('Barber tidak ditemukan');
      }

      if (newBarber.branch_id !== apt.branch_id) {
        set.status = 400;
        return createErrorResponse('Barber tidak terdaftar pada cabang appointment ini');
      }

      const { data: updated, error } = await supabase
        .from('appointments')
        .update({ barber_id: body.barber_id, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .select()
        .single();

      if (error) {
        if (error.code === '23P01') {
          set.status = 409;
          return createErrorResponse('Barber baru sudah memiliki appointment yang overlap pada jadwal ini');
        }
        throw new Error(error.message);
      }

      await supabase.from('appointment_events').insert({
        appointment_id: params.id,
        event_type: 'BARBER_REASSIGNED',
        actor_type: 'staff',
        actor_id: staffId,
        actor_role: 'admin',
        from_status: apt.status,
        to_status: apt.status,
        reason: `Barber direassign ke ${newBarber.display_name} oleh admin`
      });

      if (body.barber_id !== apt.barber_id) {
        emitNewOrder(body.barber_id, { type: 'BARBER_REASSIGNED', appointmentId: params.id } as any);
      }

      await AuditService.logAction(
        'admin', staffId, 'REASSIGN_BARBER', 'appointments', params.id,
        { barber_id: apt.barber_id }, { barber_id: body.barber_id }, apt.branch_id
      );

      return createSuccessResponse('Barber berhasil direassign', updated);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }
}
