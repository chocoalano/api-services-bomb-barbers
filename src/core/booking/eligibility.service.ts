// ============================================================================
// PEMUAT KONTEKS ATURAN BOOKING (satu-satunya yang menyentuh DB)
// ----------------------------------------------------------------------------
// `rules/` memutuskan, berkas ini yang MENGAMBIL datanya. Dipakai oleh
// pre-flight `createAppointment`, `pickBestAvailableBarber`, dan jalur
// reassignment — sehingga ketiganya melihat fakta yang sama persis dengan
// generator slot.
//
// Menutup: E2 (cuti), E3 (staff nonaktif), E7 (cakupan kuota).
// ============================================================================

import { and, eq, gt, gte, inArray, isNull, lt, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../lib/db';
import {
  appointments,
  barbers,
  barberTimeOff,
  branchOperatingHours,
  staffUsers
} from '../../db/schema';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  INACTIVE_APPOINTMENT_STATUSES,
  jakartaParts
} from '../../config/booking';
import {
  blockOf,
  resolveOperatingWindow,
  type BarberSnapshot,
  type OperatingWindow,
  type TimeRange
} from './rules';

const isMissingRelationError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    message.includes('barber_time_off')
  );
};

/** Rentang hari kalender Jakarta yang memuat `instant`. */
export const jakartaDayBounds = (instant: Date) => {
  const { date } = jakartaParts(instant);
  const dayStart = new Date(`${date}T00:00:00+07:00`);
  return { date, dayStart, dayEnd: new Date(dayStart.getTime() + 24 * 3_600_000) };
};

/**
 * Jam operasional cabang untuk hari kalender dari `instant`.
 * `null` bila barisnya tidak ada — pemanggil WAJIB menolak (E4).
 */
export const loadOperatingWindow = async (
  branchId: string,
  instant: Date
): Promise<OperatingWindow | null> => {
  const { date } = jakartaParts(instant);
  const [year, month, day] = date.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const [row] = await db
    .select({
      open_time: branchOperatingHours.openTime,
      close_time: branchOperatingHours.closeTime,
      is_closed: branchOperatingHours.isClosed
    })
    .from(branchOperatingHours)
    .where(
      and(eq(branchOperatingHours.branchId, branchId), eq(branchOperatingHours.dayOfWeek, dayOfWeek))
    )
    .limit(1);

  return resolveOperatingWindow(row ?? null);
};

/**
 * Kandidat barber sebuah cabang beserta status keaktifan staff (E3).
 * Tidak memfilter apa pun selain "milik cabang & belum dihapus" — penyaringan
 * adalah tugas `evaluateBarber`, agar alasan penolakannya bisa dilaporkan.
 */
export const loadBarberSnapshots = async (
  branchId: string,
  opts: { barberId?: string | null } = {}
): Promise<BarberSnapshot[]> => {
  const conds: SQL[] = [eq(barbers.branchId, branchId), isNull(barbers.deletedAt)];
  if (opts.barberId) conds.push(eq(barbers.id, opts.barberId));

  const rows = await db
    .select({
      id: barbers.id,
      live_status: barbers.liveStatus,
      approval_status: barbers.approvalStatus,
      staff_is_active: staffUsers.isActive,
      staff_deleted_at: staffUsers.deletedAt
    })
    .from(barbers)
    .leftJoin(staffUsers, eq(barbers.staffUserId, staffUsers.id))
    .where(and(...conds));

  return rows.map((row: any) => ({
    id: row.id,
    live_status: row.live_status,
    approval_status: row.approval_status,
    staff_active: row.staff_is_active !== false && row.staff_deleted_at == null
  }));
};

export type BarberLoadContext = {
  /** barber_id → jumlah order aktif pada hari itu (LINTAS CABANG — E7). */
  dayOrderCount: Map<string, number>;
  /** barber_id → blok okupansi order yang sudah ada. */
  blocks: Map<string, TimeRange[]>;
  /** barber_id → rentang cuti yang disetujui/aktif. */
  timeOff: Map<string, TimeRange[]>;
};

/**
 * Muat kuota harian, blok okupansi, dan cuti untuk sekumpulan barber pada satu
 * instant. Satu query per jenis data, tanpa N+1 seperti implementasi lama
 * `pickBestAvailableBarber` (satu COUNT + satu SELECT per kandidat).
 */
export const loadBarberContext = async (
  barberIds: string[],
  instant: Date,
  opts: { excludeAppointmentIds?: string[] | null } = {}
): Promise<BarberLoadContext> => {
  const dayOrderCount = new Map<string, number>();
  const blocks = new Map<string, TimeRange[]>();
  const timeOff = new Map<string, TimeRange[]>();
  if (barberIds.length === 0) return { dayOrderCount, blocks, timeOff };

  const { dayStart, dayEnd } = jakartaDayBounds(instant);
  const exclude = (opts.excludeAppointmentIds ?? []).filter(Boolean);

  const rows = await db
    .select({
      id: appointments.id,
      barber_id: appointments.barberId,
      status: appointments.status,
      scheduled_at: appointments.scheduledAt,
      scheduled_end_at: appointments.scheduledEndAt,
      schedule_block_start_at: appointments.scheduleBlockStartAt,
      schedule_block_end_at: appointments.scheduleBlockEndAt
    })
    .from(appointments)
    .where(
      and(
        inArray(appointments.barberId, barberIds),
        notInArray(appointments.status, INACTIVE_APPOINTMENT_STATUSES as any),
        // Diperlebar sehari ke belakang agar blok order yang mulai sebelum
        // tengah malam tetap terlihat oleh cek bentrok.
        gte(appointments.scheduledAt, new Date(dayStart.getTime() - 24 * 3_600_000).toISOString()),
        lt(appointments.scheduledAt, dayEnd.toISOString()),
        ...(exclude.length > 0 ? [notInArray(appointments.id, exclude)] : [])
      )
    );

  for (const row of rows as any[]) {
    if (!row.barber_id) continue;

    const startedAt = row.scheduled_at ? new Date(row.scheduled_at) : null;
    if (startedAt && startedAt >= dayStart && startedAt < dayEnd) {
      dayOrderCount.set(row.barber_id, (dayOrderCount.get(row.barber_id) ?? 0) + 1);
    }

    if (!ACTIVE_APPOINTMENT_STATUSES.includes(row.status)) continue;
    const block = blockOf(row);
    if (!block) continue;
    const list = blocks.get(row.barber_id) ?? [];
    list.push(block);
    blocks.set(row.barber_id, list);
  }

  // [E2] Cuti: dulu hanya generator & prosedur yang mengeceknya, sehingga
  // auto-pick justru mengutamakan barber cuti (0 order = paling idle).
  try {
    const leaves = await db
      .select({
        barber_id: barberTimeOff.barberId,
        start_at: barberTimeOff.startAt,
        end_at: barberTimeOff.endAt,
        status: barberTimeOff.status
      })
      .from(barberTimeOff)
      .where(
        and(
          inArray(barberTimeOff.barberId, barberIds),
          lt(barberTimeOff.startAt, dayEnd.toISOString()),
          gt(barberTimeOff.endAt, new Date(dayStart.getTime() - 24 * 3_600_000).toISOString())
        )
      );

    for (const leave of leaves as any[]) {
      if (leave.status && !['approved', 'active'].includes(leave.status)) continue;
      const list = timeOff.get(leave.barber_id) ?? [];
      list.push({ start: new Date(leave.start_at), end: new Date(leave.end_at) });
      timeOff.set(leave.barber_id, list);
    }
  } catch (error: any) {
    // Tabel belum ada (migrasi belum jalan) → perlakukan seperti tanpa cuti,
    // sama seperti generator slot.
    if (!isMissingRelationError(error)) throw error;
  }

  return { dayOrderCount, blocks, timeOff };
};

/** Jumlah order aktif barber pada hari sebuah instant (lintas cabang). */
export const countBarberOrdersForDay = async (
  barberId: string,
  instant: Date,
  excludeAppointmentId?: string | null
): Promise<number> => {
  const { dayStart, dayEnd } = jakartaDayBounds(instant);
  const conds: SQL[] = [
    eq(appointments.barberId, barberId),
    notInArray(appointments.status, INACTIVE_APPOINTMENT_STATUSES as any),
    gte(appointments.scheduledAt, dayStart.toISOString()),
    lt(appointments.scheduledAt, dayEnd.toISOString())
  ];
  if (excludeAppointmentId) conds.push(ne(appointments.id, excludeAppointmentId));

  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(appointments)
    .where(and(...conds));
  return Number(rows[0]?.count ?? 0);
};
