// ============================================================================
// ESKALASI ORDER LUNAS YANG TIDAK KUNJUNG DITERIMA BARBER  [temuan B1]
// ----------------------------------------------------------------------------
// Order berbayar yang barbernya tidak pernah menekan "Terima" sebelumnya TIDAK
// punya jalur keluar sama sekali:
//   - ORDER_ACCEPTANCE_TIMEOUT melewati order lunas (`if (isPaid) return`)
//   - APPOINTMENT_NO_SHOW_TIMEOUT hanya menyentuh `confirmed` / `in_queue`
// Akibatnya order menggantung selamanya sambil memakan blok 2 jam dan kuota
// harian barber tersebut.
//
// Kebijakan (E1): ALIHKAN ke barber lain lebih dulu, batalkan + refund hanya
// sebagai jaring terakhir. Order tetap berstatus `pending` setelah dialihkan —
// barber baru harus menerimanya secara sadar; memaksa auto-confirm hanya
// memindahkan masalah ke orang lain.
// ============================================================================

import { db } from '../../lib/db';
import { appointments, payments, appointmentEvents } from '../../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppointmentService } from './service';
import { emitNewOrder, emitAppointmentStatusChanged } from '../../lib/socket';
import { logger } from '../../lib/logger';

/** Maksimal berapa kali satu order boleh dipindahkan sebelum menyerah. */
export const MAX_REASSIGN_ATTEMPTS = 2;

export const PAID_ORDER_REASSIGNED = 'PAID_ORDER_REASSIGNED';

export type EscalationOutcome =
  | { action: 'skipped'; reason: string }
  | { action: 'reassigned'; fromBarberId: string | null; toBarberId: string }
  | { action: 'exhausted'; reason: string };

/** Berapa kali order ini sudah pernah dialihkan. */
const countReassignments = async (appointmentId: string) => {
  const rows = await db
    .select({ id: appointmentEvents.id })
    .from(appointmentEvents)
    .where(
      and(
        eq(appointmentEvents.appointmentId, appointmentId),
        eq(appointmentEvents.eventType, PAID_ORDER_REASSIGNED)
      )
    );
  return rows.length;
};

const recordReassignment = async (params: {
  appointmentId: string;
  fromBarberId: string | null;
  toBarberId: string;
  attempt: number;
}) => {
  try {
    await db.insert(appointmentEvents).values({
      id: randomUUID(),
      appointmentId: params.appointmentId,
      eventType: PAID_ORDER_REASSIGNED,
      // Status tidak berubah saat dialihkan — hanya barbernya. `to_status`
      // wajib diisi oleh skema, jadi diisi status saat ini.
      fromStatus: 'pending',
      toStatus: 'pending',
      actorType: 'system',
      actorRole: 'system',
      actorId: null,
      reason:
        `Order lunas dialihkan otomatis (percobaan ${params.attempt}) dari `
        + `${params.fromBarberId ?? 'tanpa barber'} ke ${params.toBarberId}`
    } as any);
  } catch (err: any) {
    // Non-fatal: pengalihan tetap sah walau jejaknya gagal ditulis.
    logger.error({ err, appointmentId: params.appointmentId }, '[Escalation] Gagal mencatat event pengalihan');
  }
};

/**
 * Jalankan satu putaran eskalasi untuk sebuah order.
 *
 * Aman dipanggil berkali-kali: order yang sudah tidak `pending`, tidak lunas,
 * atau sudah habis jatah pengalihannya akan dilewati.
 */
export const escalatePaidPendingOrder = async (
  appointmentId: string,
  opts: { finalStage?: boolean } = {}
): Promise<EscalationOutcome> => {
  const [apt] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      source: appointments.source,
      branch_id: appointments.branchId,
      barber_id: appointments.barberId,
      customer_id: appointments.customerId,
      scheduled_at: appointments.scheduledAt
    })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (!apt) return { action: 'skipped', reason: 'appointment_not_found' };
  if (apt.status !== 'pending') return { action: 'skipped', reason: 'not_pending' };
  if (apt.source !== 'online_booking') return { action: 'skipped', reason: 'not_online_booking' };
  if (!apt.scheduled_at) return { action: 'skipped', reason: 'no_schedule' };

  const payRows = await db
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.appointmentId, appointmentId));
  if (!payRows.some((p) => p.status === 'paid')) {
    // Order belum lunas tetap ditangani ORDER_ACCEPTANCE_TIMEOUT seperti biasa.
    return { action: 'skipped', reason: 'not_paid' };
  }

  const attempts = await countReassignments(appointmentId);
  if (!opts.finalStage && attempts >= MAX_REASSIGN_ATTEMPTS) {
    return { action: 'exhausted', reason: 'max_attempts_reached' };
  }
  if (opts.finalStage) {
    return { action: 'exhausted', reason: 'final_stage' };
  }

  // Cari pengganti dengan aturan yang sama persis dengan auto-assign saat order
  // dibuat (idle, Open Order, kuota harian, blok 2 jam), minus barber saat ini.
  let nextBarberId: string;
  try {
    nextBarberId = await AppointmentService.pickReplacementBarber(
      apt.branch_id,
      apt.scheduled_at,
      apt.barber_id ? [apt.barber_id] : [],
      // [E9] Sertakan order-nya agar radius home_service & durasi layanan ikut
      // dihormati saat memilih pengganti.
      { appointmentId }
    );
  } catch {
    return { action: 'exhausted', reason: 'no_barber_available' };
  }

  await db
    .update(appointments)
    .set({ barberId: nextBarberId })
    .where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'pending')));

  await recordReassignment({
    appointmentId,
    fromBarberId: apt.barber_id ?? null,
    toBarberId: nextBarberId,
    attempt: attempts + 1
  });

  // Barber BARU: order masuk antreannya.
  emitNewOrder(nextBarberId, {
    appointment_id: appointmentId,
    timestamp: new Date().toISOString()
  });

  // Barber LAMA & customer: kartu berubah/hilang — tanpa pemberitahuan ini
  // pengalihan terbaca sebagai kesalahan sistem.
  emitAppointmentStatusChanged({
    appointment_id: appointmentId,
    status: apt.status,
    raw_status: apt.status,
    barber_id: apt.barber_id ?? null,
    customer_id: apt.customer_id ?? null,
    branch_id: apt.branch_id ?? null,
    timestamp: new Date().toISOString()
  });

  logger.info(
    { appointmentId, from: apt.barber_id, to: nextBarberId, attempt: attempts + 1 },
    '[Escalation] Order lunas dialihkan ke barber lain'
  );

  return { action: 'reassigned', fromBarberId: apt.barber_id ?? null, toBarberId: nextBarberId };
};

/**
 * Daftar order lunas yang masih `pending` padahal jadwalnya sudah dekat/lewat —
 * untuk laporan admin. Tanpa ini, kegagalan pengalihan hanya terlihat di log.
 */
export const listStuckPaidOrders = async (limit = 50) => {
  const rows = await db
    .select({
      appointment_id: appointments.id,
      branch_id: appointments.branchId,
      barber_id: appointments.barberId,
      customer_id: appointments.customerId,
      scheduled_at: appointments.scheduledAt,
      payment_status: payments.status
    })
    .from(appointments)
    .innerJoin(payments, eq(payments.appointmentId, appointments.id))
    .where(
      and(
        eq(appointments.status, 'pending'),
        eq(appointments.source, 'online_booking'),
        eq(payments.status, 'paid')
      )
    )
    .orderBy(desc(appointments.scheduledAt))
    .limit(limit);
  return rows;
};
