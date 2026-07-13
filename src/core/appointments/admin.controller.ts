import { randomUUID } from 'crypto';
import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { handleControllerError } from '../../shared/controller-error';
import { AppointmentService } from './service';
import { db } from '../../lib/db';
import { snakeKeys, toDbDate } from '../../db/helpers';
import { barbers, appointments, customers, appointmentEvents } from '../../db/schema';
import { and, eq, inArray, isNull, asc } from 'drizzle-orm';
import { AuditService } from '../../modules/admin/audit/service';
import { emitNewOrder } from '../../lib/socket';

export class AdminAppointmentController {
  static async createWalkIn({ params, body, staffId, headers, set }: any) {
    try {
      // Application-level guard: barber_id (if provided) must belong to the target branch.
      // This prevents cross-branch assignment before the request even reaches the DB RPC.
      if (body?.barber_id) {
        const [barber] = await db
          .select({ branch_id: barbers.branchId })
          .from(barbers)
          .where(and(eq(barbers.id, body.barber_id), isNull(barbers.deletedAt)))
          .limit(1);
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
      return handleControllerError(err, set, 'admin.createWalkIn', { detail: false });
    }
  }

  static async getBranchQueue({ params, set }: any) {
    try {
      const rows = await db
        .select({ appt: appointments, barberDisplayName: barbers.displayName, custFullName: customers.fullName })
        .from(appointments)
        .leftJoin(barbers, eq(appointments.barberId, barbers.id))
        .leftJoin(customers, eq(appointments.customerId, customers.id))
        .where(and(eq(appointments.branchId, params.branchId), inArray(appointments.status, ['pending', 'confirmed', 'in_queue', 'in_service'])))
        .orderBy(asc(appointments.queuePosition));
      const data = rows.map((r) => ({
        ...snakeKeys(r.appt),
        barbers: r.barberDisplayName != null ? { display_name: r.barberDisplayName } : null,
        customers: r.custFullName != null ? { full_name: r.custFullName } : null
      }));
      return createSuccessResponse('Daftar antrean cabang', data);
    } catch (err: any) {
      return handleControllerError(err, set, 'admin.getBranchQueue', { status: 400, detail: false });
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
      return handleControllerError(err, set, 'admin.updateStatus', { detail: false });
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
      return handleControllerError(err, set, 'admin.updateDestination', { detail: false });
    }
  }

  static async reassignBarber({ params, body, staffId, set }: any) {
    try {
      const [apt] = await db
        .select({
          id: appointments.id,
          branch_id: appointments.branchId,
          barber_id: appointments.barberId,
          status: appointments.status,
          customer_id: appointments.customerId
        })
        .from(appointments)
        .where(eq(appointments.id, params.id))
        .limit(1);

      if (!apt) {
        set.status = 404;
        return createErrorResponse('Appointment tidak ditemukan');
      }

      if (['completed', 'cancelled', 'no_show'].includes(apt.status)) {
        set.status = 400;
        return createErrorResponse('Tidak dapat reassign barber pada appointment yang sudah selesai/dibatalkan');
      }

      const [newBarber] = await db
        .select({ id: barbers.id, branch_id: barbers.branchId, display_name: barbers.displayName })
        .from(barbers)
        .where(and(eq(barbers.id, body.barber_id), isNull(barbers.deletedAt)))
        .limit(1);

      if (!newBarber) {
        set.status = 400;
        return createErrorResponse('Barber tidak ditemukan');
      }

      if (newBarber.branch_id !== apt.branch_id) {
        set.status = 400;
        return createErrorResponse('Barber tidak terdaftar pada cabang appointment ini');
      }

      const now = toDbDate(new Date());
      // Reset chat: barber baru tidak boleh melihat riwayat chat lama. (M7)
      await db
        .update(appointments)
        .set({ barberId: body.barber_id, chatClearedAt: now })
        .where(eq(appointments.id, params.id));
      const [updated] = snakeKeys(
        await db.select().from(appointments).where(eq(appointments.id, params.id)).limit(1)
      );

      await db.insert(appointmentEvents).values({
        id: randomUUID(),
        appointmentId: params.id,
        eventType: 'BARBER_REASSIGNED',
        actorType: 'staff',
        actorId: staffId,
        actorRole: 'admin',
        fromStatus: apt.status,
        toStatus: apt.status,
        reason: `Barber direassign ke ${newBarber.display_name} oleh admin`
      } as any);

      if (body.barber_id !== apt.barber_id) {
        const timestamp = new Date().toISOString();
        // Notifikasi barber baru dengan payload yang benar (appointment_id/timestamp,
        // bukan field camelCase yang tak terbaca klien). (M18)
        emitNewOrder(body.barber_id, { appointment_id: params.id, timestamp });
        // Beri tahu barber lama agar daftar order-nya menyegar & melepas order ini.
        if (apt.barber_id) {
          emitNewOrder(apt.barber_id, { appointment_id: params.id, timestamp });
        }
      }

      await AuditService.logAction(
        'admin', staffId, 'REASSIGN_BARBER', 'appointments', params.id,
        { barber_id: apt.barber_id }, { barber_id: body.barber_id }, apt.branch_id
      );

      return createSuccessResponse('Barber berhasil direassign', updated);
    } catch (err: any) {
      return handleControllerError(err, set, 'admin.reassignBarber', { detail: false });
    }
  }
}
