// ============================================================================
// BLOK OKUPANSI BARBER — SATU DEFINISI
// ----------------------------------------------------------------------------
// [E5] Sebelumnya ada dua definisi: TS/generator memakai 2 jam datar, prosedur
//      DB memakai durasi layanan saja. Akibatnya dua order in_store 30 menit
//      berjarak 45 menit ditolak pre-check tapi DITERIMA prosedur.
// [E11] Blok juga tidak pernah melebihi 2 jam, sehingga layanan gabungan
//      >2 jam hanya mengunci 2 jam → overbooking senyap.
// Keputusan klien 2026-07-21: blok = max(2 jam, durasi + buffer).
// [E10] Baris lama dengan `schedule_block_*` NULL tetap memblok slotnya
//      (dulu dilewatkan diam-diam oleh cek overlap prosedur).
// ============================================================================

import { BOOKING_CONFIG } from '../../../config/booking';
import type { AppointmentSnapshot, TimeRange } from './types';

const BARBER_BLOCK_MIN = BOOKING_CONFIG.barberBlockMinutes;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60_000);

/**
 * Blok okupansi yang DIMINTA sebuah order baru.
 * Buffer perjalanan (home_service) mengembang ke kedua sisi, persis seperti
 * yang sudah disimpan prosedur; lantai 2 jam berlaku setelah buffer.
 */
export const computeScheduleBlock = (input: {
  startAt: Date;
  durationMin: number;
  travelBufferMin?: number;
}): TimeRange => {
  const buffer = Math.max(input.travelBufferMin ?? 0, 0);
  const start = addMinutes(input.startAt, -buffer);
  const serviceEnd = addMinutes(input.startAt, Math.max(input.durationMin, 0) + buffer);
  const minimumEnd = addMinutes(start, BARBER_BLOCK_MIN);
  return { start, end: serviceEnd > minimumEnd ? serviceEnd : minimumEnd };
};

/**
 * Blok okupansi sebuah order YANG SUDAH ADA. Menggantikan tiga salinan identik
 * di `availability/service.ts`, `appointments/service.ts` (dua tempat).
 * Mengembalikan null hanya bila baris benar-benar tanpa jadwal.
 */
export const blockOf = (appointment: AppointmentSnapshot): TimeRange | null => {
  const start =
    toDate(appointment.schedule_block_start_at) ?? toDate(appointment.scheduled_at);
  if (!start) return null;

  const storedEnd =
    toDate(appointment.schedule_block_end_at) ?? toDate(appointment.scheduled_end_at);
  const minimumEnd = addMinutes(start, BARBER_BLOCK_MIN);
  return { start, end: storedEnd && storedEnd > minimumEnd ? storedEnd : minimumEnd };
};

/** [start, end) saling bertumpuk? */
export const rangesOverlap = (a: TimeRange, b: TimeRange): boolean =>
  a.start < b.end && a.end > b.start;
