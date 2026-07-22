import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { barberOpenOrders, branchOperatingHours } from '../../db/schema';
import { and, eq, asc } from 'drizzle-orm';
import {
  BOOKING_CONFIG,
  generateBarberOpenOrderSlots,
  getOpenOrderPeriodForCustomerSlot,
  isValidBarberOpenOrderSlot,
  jakartaParts,
  timeToMinutes
} from '../../config/booking';

/** Jam buka/tutup cabang (menit-dalam-hari) yang meng-anchor grid Open Order. */
export type BranchGrid = { openMin: number; closeMin: number };

/**
 * Konteks Open Order untuk satu cabang + tanggal, dimuat sekali lalu dipakai
 * berkali-kali (mis. saat auto-assign menyaring banyak barber).
 */
export type OpenOrderContext = {
  /** false bila tabel barber_open_orders belum ada (migrasi belum diterapkan). */
  tableAvailable: boolean;
  /** barber_id → himpunan periode 'HH:MM' yang dibuka barber pada tanggal itu. */
  openByBarber: Map<string, Set<string>>;
  /** [R3] Jam buka/tutup cabang pada tanggal itu — meng-anchor grid 2 jam. */
  grid: BranchGrid;
};

const makeError = (message: string, status = 400, code?: string) => {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code) error.code = code;
  return error;
};

const isMissingRelationError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    error?.code === 'PGRST200' ||
    message.includes('barber_open_orders')
  );
};

/** Normalkan nilai time DB ('HH:MM:SS') → 'HH:MM'. */
const toHHMM = (value: string) => String(value).slice(0, 5);

/** Ekstrak tanggal lokal (YYYY-MM-DD) dari sebuah instant/ISO. */
const jakartaDate = (iso: string) => jakartaParts(new Date(iso)).date;

export class OpenOrderService {
  /**
   * [R3] Jam buka/tutup cabang untuk hari kalender `date`, meng-anchor grid
   * Open Order (kelipatan 2 jam) ke jam BUKA cabang. Non-fatal & backward
   * compatible: bila baris tidak ada / libur / jam invalid → fallback ke
   * konstanta config (08:00–22:00), sehingga cabang default tak berubah.
   */
  static async loadBranchGrid(branchId: string, date: string): Promise<BranchGrid> {
    const fallback: BranchGrid = {
      openMin: BOOKING_CONFIG.operationalStartMinutes,
      closeMin: BOOKING_CONFIG.operationalLastBookingMinutes
    };
    try {
      const [y, m, d] = date.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const [oh] = await db
        .select({
          open_time: branchOperatingHours.openTime,
          close_time: branchOperatingHours.closeTime,
          is_closed: branchOperatingHours.isClosed
        })
        .from(branchOperatingHours)
        .where(and(eq(branchOperatingHours.branchId, branchId), eq(branchOperatingHours.dayOfWeek, dow)))
        .limit(1);
      if (oh && !oh.is_closed && oh.open_time && oh.close_time) {
        const openMin = timeToMinutes(String(oh.open_time));
        const closeMin = timeToMinutes(String(oh.close_time));
        if (closeMin > openMin) return { openMin, closeMin };
      }
    } catch {
      // fallback ke default config
    }
    return fallback;
  }

  /**
   * [SPEC BOOKING §5/§14] Muat semua periode Open Order barber pada satu cabang &
   * tanggal. Aman bila tabel belum ada: tableAvailable=false → gating dinonaktifkan.
   */
  static async loadContext(branchId: string, date: string): Promise<OpenOrderContext> {
    const openByBarber = new Map<string, Set<string>>();
    const grid = await this.loadBranchGrid(branchId, date);

    let data: { barber_id: string; start_time: string }[];
    try {
      data = await db
        .select({ barber_id: barberOpenOrders.barberId, start_time: barberOpenOrders.startTime })
        .from(barberOpenOrders)
        .where(and(eq(barberOpenOrders.branchId, branchId), eq(barberOpenOrders.orderDate, date)));
    } catch (error: any) {
      if (isMissingRelationError(error)) {
        return { tableAvailable: false, openByBarber, grid };
      }
      throw makeError('Gagal mengambil data Open Order barber');
    }

    for (const row of data) {
      const set = openByBarber.get(row.barber_id) ?? new Set<string>();
      set.add(toHHMM(row.start_time));
      openByBarber.set(row.barber_id, set);
    }

    return { tableAvailable: true, openByBarber, grid };
  }

  /** Muat context berdasarkan instant booking (ISO), memakai tanggal lokalnya. */
  static async loadContextForIso(branchId: string, scheduledAtIso: string) {
    return this.loadContext(branchId, jakartaDate(scheduledAtIso));
  }

  /**
   * [SPEC BOOKING §10.3/§11.3] Apakah barber "membuka Open Order" untuk periode
   * yang mencakup jam booking customer?
   * - Slot booking tidak valid → false.
   * - Tabel belum ada → true (gating dinonaktifkan, backward compatible).
   * - Barber punya record Open Order pada tanggal itu → hanya periode yang dibuka.
   * - Barber tidak punya record sama sekali → tergantung BOOKING_REQUIRE_OPEN_ORDER
   *   (strict: false; backward compatible/default: true).
   */
  static isBarberOpen(context: OpenOrderContext, barberId: string, bookingTime: string): boolean {
    const period = getOpenOrderPeriodForCustomerSlot(
      bookingTime,
      context.grid.openMin,
      context.grid.closeMin
    );
    if (!period) return false;
    if (!context.tableAvailable) return true;

    const opened = context.openByBarber.get(barberId);
    if (opened && opened.size > 0) return opened.has(period);
    return !BOOKING_CONFIG.requireOpenOrder;
  }

  /**
   * Versi single-barber (dipakai jalur create manual). `bookingTime` = 'HH:MM'
   * jam booking; `date` = tanggal lokal YYYY-MM-DD.
   */
  static async isBarberOpenForBookingTime(
    barberId: string,
    branchId: string,
    date: string,
    bookingTime: string
  ): Promise<boolean> {
    const context = await this.loadContext(branchId, date);
    return this.isBarberOpen(context, barberId, bookingTime);
  }

  /** Versi single-barber berbasis instant ISO (jam booking diturunkan darinya). */
  static async isBarberOpenForIso(
    barberId: string,
    branchId: string,
    scheduledAtIso: string
  ): Promise<boolean> {
    const { date, minutes } = jakartaParts(new Date(scheduledAtIso));
    const bookingTime = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return this.isBarberOpenForBookingTime(barberId, branchId, date, bookingTime);
  }

  // ==========================================================================
  // POV BARBER — kelola Open Order (spec §4 & §14)
  // ==========================================================================

  /** Daftar Open Order barber pada satu tanggal (urut jam). */
  static async listForBarber(barberId: string, date: string) {
    let data: { id: string; order_date: string; start_time: string }[];
    try {
      data = await db
        .select({ id: barberOpenOrders.id, order_date: barberOpenOrders.orderDate, start_time: barberOpenOrders.startTime })
        .from(barberOpenOrders)
        .where(and(eq(barberOpenOrders.barberId, barberId), eq(barberOpenOrders.orderDate, date)))
        .orderBy(asc(barberOpenOrders.startTime));
    } catch (error: any) {
      if (isMissingRelationError(error)) return [];
      throw makeError('Gagal mengambil Open Order');
    }

    return data.map((row: any) => ({
      id: row.id,
      order_date: row.order_date,
      start_time: toHHMM(row.start_time)
    }));
  }

  /**
   * Buka satu/lebih periode Open Order untuk barber pada tanggal tertentu.
   * Menolak jam yang bukan kelipatan 2 jam (08:00–22:00).
   */
  static async openSlots(
    barberId: string,
    branchId: string,
    date: string,
    startTimes: string[]
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw makeError('order_date wajib format YYYY-MM-DD');
    }
    const times = Array.from(new Set(startTimes.map((t) => t.trim()).filter(Boolean)));
    if (times.length === 0) {
      throw makeError('Minimal satu jam Open Order wajib dikirim');
    }
    // [R3] Grid Open Order mengikuti jam buka/tutup cabang pada tanggal itu.
    const grid = await this.loadBranchGrid(branchId, date);
    for (const time of times) {
      if (!isValidBarberOpenOrderSlot(time, grid.openMin, grid.closeMin)) {
        throw makeError(
          'Open Order hanya dapat dibuka pada jam kelipatan 2 jam dalam jam operasional cabang.',
          400,
          'INVALID_OPEN_ORDER_SLOT'
        );
      }
    }

    const rows = times.map((time) => ({
      id: randomUUID(),
      barberId,
      branchId,
      orderDate: date,
      startTime: `${time}:00`
    }));

    try {
      // ignoreDuplicates: no-op update pada baris yang sudah ada (unique barber+date+start).
      await db
        .insert(barberOpenOrders)
        .values(rows)
        .onDuplicateKeyUpdate({ set: { startTime: sql`start_time` } });
    } catch (error: any) {
      if (isMissingRelationError(error)) {
        throw makeError('Fitur Open Order belum aktif. Terapkan migrasi barber_open_orders.', 503, 'OPEN_ORDER_NOT_MIGRATED');
      }
      throw makeError('Gagal menyimpan Open Order: ' + (error?.message ?? 'unknown'));
    }

    // Kembalikan snapshot terkini.
    return this.listForBarber(barberId, date);
  }

  /** Tutup satu periode Open Order milik barber. */
  static async closeSlot(barberId: string, branchId: string, date: string, startTime: string) {
    const grid = await this.loadBranchGrid(branchId, date);
    if (!isValidBarberOpenOrderSlot(startTime, grid.openMin, grid.closeMin)) {
      throw makeError('Jam Open Order tidak valid.', 400, 'INVALID_OPEN_ORDER_SLOT');
    }
    try {
      await db
        .delete(barberOpenOrders)
        .where(
          and(
            eq(barberOpenOrders.barberId, barberId),
            eq(barberOpenOrders.orderDate, date),
            eq(barberOpenOrders.startTime, `${startTime}:00`)
          )
        );
    } catch (error: any) {
      if (!isMissingRelationError(error)) {
        throw makeError('Gagal menutup Open Order: ' + (error?.message ?? 'unknown'));
      }
    }
    return this.listForBarber(barberId, date);
  }

  /**
   * Slot Open Order yang mungkin dibuka (untuk ditampilkan di UI barber).
   * [R3] Bila `branchId` diberikan, grid mengikuti jam buka/tutup cabang pada
   * `date`; jika tidak, memakai konstanta config (08:00–22:00).
   */
  static async availableSlotOptions(date?: string, branchId?: string) {
    if (branchId && date) {
      const grid = await this.loadBranchGrid(branchId, date);
      return generateBarberOpenOrderSlots(date, grid.openMin, grid.closeMin);
    }
    return generateBarberOpenOrderSlots(date);
  }
}
