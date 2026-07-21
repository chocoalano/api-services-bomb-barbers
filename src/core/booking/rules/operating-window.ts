// ============================================================================
// JAM OPERASIONAL — SATU DEFINISI UNTUK GENERATOR, PRE-FLIGHT, & PROSEDUR
// ----------------------------------------------------------------------------
// [E1] Keputusan klien 2026-07-21: layanan WAJIB SELESAI paling lambat
//      `close_time`. Karena itu jam mulai terakhir bergantung durasi layanan —
//      layanan 60 menit pada cabang yang tutup 22:00 hanya boleh mulai 21:00.
//      Sebelumnya generator hanya membandingkan jam MULAI sehingga menawarkan
//      slot 22:00 yang pasti ditolak prosedur.
// [E4] Baris `branch_operating_hours` yang hilang = TOLAK (fail-closed), bukan
//      fallback diam-diam ke 08:00–22:00. Prosedur sudah menolak; generator
//      dulu tidak, sehingga seluruh daftar slotnya palsu.
// ============================================================================

import { BOOKING_CONFIG, jakartaParts, timeToMinutes } from '../../../config/booking';
import { deny, OK, type OperatingWindow, type RuleVerdict } from './types';

export type OperatingHoursRow = {
  open_time?: string | null;
  close_time?: string | null;
} | null | undefined;

/**
 * Baris `branch_operating_hours` → jendela operasional.
 * `null` bila baris tidak ada atau jamnya tidak masuk akal (tutup <= buka):
 * pemanggil WAJIB memperlakukannya sebagai penolakan (`BRANCH_HOURS_MISSING`).
 */
export const resolveOperatingWindow = (row: OperatingHoursRow): OperatingWindow | null => {
  if (!row?.open_time || !row?.close_time) return null;

  let openMin: number;
  let closeMin: number;
  try {
    openMin = timeToMinutes(String(row.open_time));
    closeMin = timeToMinutes(String(row.close_time));
  } catch {
    return null;
  }
  if (!(closeMin > openMin)) return null;

  return {
    openMin,
    closeMin,
    lastBookingStartMin: BOOKING_CONFIG.operationalLastBookingMinutes
  };
};

/**
 * [E1] Jam MULAI terakhir yang sah untuk durasi layanan tertentu.
 * = min(batas 22:00 dari config, jam tutup − durasi).
 * Bisa lebih kecil dari `openMin` bila layanannya lebih panjang dari jam buka
 * cabang — artinya tidak ada slot sama sekali, dan itu memang jawaban yang benar.
 */
export const lastBookableStartMinutes = (
  window: OperatingWindow,
  durationMin: number
): number => Math.min(window.lastBookingStartMin, window.closeMin - Math.max(durationMin, 0));

/**
 * Apakah layanan berdurasi `durationMin` yang dimulai pada `startAt` muat di
 * dalam jam operasional? Ini SATU-SATUNYA tempat perbandingan itu ditulis.
 *
 * Catatan sengaja: yang dibatasi `close_time` hanyalah waktu selesai LAYANAN.
 * Blok okupansi barber (minimal 2 jam, lihat `schedule-block.ts`) boleh
 * melewati jam tutup — ia mencegah order kedua, bukan pekerjaan yang dilayani.
 */
export const fitsOperatingWindow = (
  startAt: Date,
  durationMin: number,
  window: OperatingWindow | null
): RuleVerdict => {
  if (!window) {
    return deny(
      'BRANCH_HOURS_MISSING',
      'Jam operasional cabang belum dikonfigurasi. Hubungi admin cabang.'
    );
  }

  const { minutes: startMin, date: startDate } = jakartaParts(startAt);
  const endAt = new Date(startAt.getTime() + Math.max(durationMin, 0) * 60_000);
  const { date: endDate } = jakartaParts(endAt);

  if (startMin < window.openMin || endDate !== startDate) {
    return deny('OUTSIDE_WORKING_HOURS', outsideMessage(window));
  }
  if (startMin > lastBookableStartMinutes(window, durationMin)) {
    return deny('OUTSIDE_WORKING_HOURS', outsideMessage(window));
  }
  return OK;
};

const pad = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const outsideMessage = (window: OperatingWindow) =>
  `Order hanya dapat dibuat pada jam kerja ${pad(window.openMin)}–${pad(window.closeMin)}, ` +
  'dan layanan harus selesai sebelum jam tutup.';
