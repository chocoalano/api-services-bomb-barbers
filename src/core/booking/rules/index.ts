// ============================================================================
// EVALUATOR ATURAN BOOKING — TITIK MASUK TUNGGAL
// ----------------------------------------------------------------------------
// Generator slot adalah DRY-RUN dari penegak: keduanya memanggil fungsi di sini.
// Rencana: plans/audit/revisi/e1_e8_satu_sumber_aturan_slot_2026-07-21.md
// ============================================================================

export * from './types';
export * from './operating-window';
export * from './schedule-block';
export * from './barber-eligibility';

import {
  BOOKING_CONFIG,
  isValidCustomerBookingSlot,
  jakartaParts,
  minutesToTime,
  satisfiesMinLead
} from '../../../config/booking';
import { fitsOperatingWindow } from './operating-window';
import { deny, OK, type OperatingWindow, type RuleVerdict } from './types';

/**
 * Aturan waktu yang tidak bergantung barber: jam operasional (termasuk jam
 * selesai layanan — E1), slot kelipatan 1 jam, dan jeda minimal 6 jam.
 *
 * @param enforceSlot false untuk order on-demand/ASAP yang memang tidak
 *   dipaksa jatuh pada jam bulat.
 * @param enforceMinLead false untuk on-demand & walk-in.
 */
export const evaluateSlotTiming = (params: {
  startAt: Date;
  durationMin: number;
  window: OperatingWindow | null;
  now?: Date;
  enforceSlot?: boolean;
  enforceMinLead?: boolean;
}): RuleVerdict => {
  const { startAt, durationMin, window } = params;

  const hours = fitsOperatingWindow(startAt, durationMin, window);
  if (!hours.ok) return hours;

  if (params.enforceSlot !== false) {
    const { minutes } = jakartaParts(startAt);
    if (!isValidCustomerBookingSlot(minutesToTime(minutes))) {
      return deny(
        'INVALID_SLOT',
        'Jadwal harus pada slot kelipatan 1 jam (08:00, 09:00, … 22:00)'
      );
    }
  }

  if (params.enforceMinLead !== false && !satisfiesMinLead(startAt, params.now ?? new Date())) {
    const hoursLead = Math.floor(BOOKING_CONFIG.minCustomerLeadMinutes / 60);
    return deny(
      'TOO_SOON',
      `Pemesanan minimal ${hoursLead} jam sebelum jadwal. Silakan pilih jam berikutnya.`
    );
  }

  return OK;
};
