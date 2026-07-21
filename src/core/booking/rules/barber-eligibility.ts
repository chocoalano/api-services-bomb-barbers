// ============================================================================
// PREDIKAT "BOLEHKAH BARBER INI MENERIMA ORDER PADA WAKTU INI"
// ----------------------------------------------------------------------------
// Satu fungsi yang menggantikan empat implementasi berbeda (generator slot,
// pre-flight, auto-pick, reassignment). Urutan pengecekannya sengaja mengikuti
// urutan penolakan prosedur atomik agar KODE ERROR yang muncul sama dari jalur
// mana pun customer/admin masuk.
//
// Menutup: E2 (cuti diabaikan auto-pick), E3 (staff nonaktif),
//          E7 (kuota beda cakupan), E5 (blok beda definisi).
// ============================================================================

import { BOOKING_CONFIG, isIdleLiveStatus } from '../../../config/booking';
import { rangesOverlap } from './schedule-block';
import { deny, OK, type BarberEvaluationInput, type RuleVerdict } from './types';

const NO_BARBER_MESSAGE =
  'Mohon maaf, tidak ada barber tersedia pada jam tersebut. Silakan pilih jam lain.';

export const evaluateBarber = (input: BarberEvaluationInput): RuleVerdict => {
  const { barber } = input;

  // [E3] Prosedur menuntut staff aktif (`appointment-procedures.ts`), generator
  // & auto-pick dulu tidak — sumber slot palsu dan auto-assign yang gagal 404.
  if (!barber.staff_active) {
    return deny('BARBER_INACTIVE', 'Barber tidak aktif.');
  }
  if (barber.approval_status !== 'approved') {
    return deny('BARBER_INACTIVE', 'Barber belum dikonfirmasi admin.');
  }
  if (!isIdleLiveStatus(barber.live_status)) {
    return deny('NO_BARBER_AVAILABLE', NO_BARBER_MESSAGE);
  }
  if (input.withinRadius === false) {
    return deny('NO_BARBER_AVAILABLE', 'Barber tidak melayani lokasi tujuan.');
  }

  // [E2] Cuti: dicek generator & prosedur, TIDAK dicek auto-pick — barber cuti
  // punya 0 order sehingga justru jadi kandidat teratas, lalu ditolak P0001.
  for (const range of input.timeOff) {
    if (rangesOverlap(input.requestedBlock, range)) {
      return deny('BARBER_ON_LEAVE', 'Barber sedang tidak tersedia pada jadwal tersebut.');
    }
  }

  if (!input.isOpenOrder) {
    return deny('BARBER_NOT_OPEN', 'Barber tidak tersedia pada jam tersebut.');
  }

  // [E7] Kuota dihitung LINTAS CABANG di semua lapisan (dulu generator
  // memfilter per cabang sehingga menawarkan slot yang pasti BARBER_QUOTA_FULL).
  if (input.dayOrderCount >= BOOKING_CONFIG.maxDailyOrdersPerBarber) {
    return deny(
      'BARBER_QUOTA_FULL',
      `Kuota harian penuh (maks ${BOOKING_CONFIG.maxDailyOrdersPerBarber} order/hari).`
    );
  }

  // [E5] Blok okupansi memakai definisi tunggal max(2 jam, durasi + buffer).
  for (const block of input.existingBlocks) {
    if (rangesOverlap(input.requestedBlock, block)) {
      return deny('NO_BARBER_AVAILABLE', NO_BARBER_MESSAGE);
    }
  }

  return OK;
};

export const NO_BARBER_AVAILABLE_MESSAGE = NO_BARBER_MESSAGE;
