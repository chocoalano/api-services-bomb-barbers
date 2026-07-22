// ============================================================================
// TIPE BERSAMA UNTUK EVALUATOR ATURAN BOOKING
// ----------------------------------------------------------------------------
// Modul `rules/` sengaja MURNI: ia menerima snapshot yang sudah dimuat pemanggil
// dan mengembalikan putusan. Tidak ada impor `db` di sini, sehingga generator
// slot, pre-flight, prosedur atomik, dan jalur reassignment bisa memakai
// predikat yang sama tanpa saling menyeret dependensi.
//
// Rencana: plans/audit/revisi/e1_e8_satu_sumber_aturan_slot_2026-07-21.md §4
// ============================================================================

/**
 * Kode putusan. Enam kode pertama SUDAH dipakai FE customer
 * (`booking_controller.dart`) — jangan diganti namanya. Tiga terakhir baru dan
 * dipetakan ke `NO_BARBER_AVAILABLE` saat dikirim ke klien (lihat
 * `toClientCode`), agar FE tidak perlu ikut berubah.
 */
export type RuleCode =
  | 'OUTSIDE_WORKING_HOURS'
  | 'INVALID_SLOT'
  | 'TOO_SOON'
  | 'BARBER_QUOTA_FULL'
  | 'BARBER_NOT_OPEN'
  | 'NO_BARBER_AVAILABLE'
  | 'BARBER_ON_LEAVE'
  | 'BARBER_INACTIVE'
  | 'BRANCH_HOURS_MISSING'
  | 'BRANCH_CLOSED_ON_DAY';

export type RuleVerdict =
  | { ok: true }
  | { ok: false; code: RuleCode; message: string };

export const OK: RuleVerdict = { ok: true };

export const deny = (code: RuleCode, message: string): RuleVerdict => ({
  ok: false,
  code,
  message
});

/**
 * Kode internal → kode yang aman dikirim ke FE. Tiga kode baru tidak dikenal
 * aplikasi customer, jadi diturunkan ke `NO_BARBER_AVAILABLE` yang sudah punya
 * pesan Indonesia di sana.
 */
export const toClientCode = (code: RuleCode): RuleCode => {
  switch (code) {
    case 'BARBER_ON_LEAVE':
    case 'BARBER_INACTIVE':
      return 'NO_BARBER_AVAILABLE';
    case 'BRANCH_HOURS_MISSING':
    case 'BRANCH_CLOSED_ON_DAY':
      // FE customer hanya mengenal OUTSIDE_WORKING_HOURS untuk urusan jam;
      // pesan spesifik (libur vs belum dikonfigurasi) tetap terbawa di `message`.
      return 'OUTSIDE_WORKING_HOURS';
    default:
      return code;
  }
};

/** Rentang waktu setengah terbuka [start, end). */
export type TimeRange = { start: Date; end: Date };

/**
 * Jam operasional cabang dalam menit-dalam-hari (waktu lokal Jakarta).
 * `null` sebagai keseluruhan berarti baris `branch_operating_hours` tidak ada —
 * kondisi itu ditangani sebagai penolakan (E4), bukan fallback diam-diam.
 */
export type OperatingWindow = {
  /** Jam buka cabang. */
  openMin: number;
  /**
   * Jam tutup cabang. Layanan WAJIB selesai paling lambat di sini, dan ini pula
   * batas atas jam MULAI booking (tidak ada lagi cap statis 22:00 — keputusan
   * klien 2026-07-22, semua mengikuti `close_time` cabang dari DB).
   */
  closeMin: number;
  /**
   * true bila cabang ditandai libur pada hari itu (hari libur eksplisit,
   * `branch_operating_hours.is_closed`). Saat true, [openMin]/[closeMin] tidak
   * bermakna dan booking ditolak dengan `BRANCH_CLOSED_ON_DAY`.
   */
  isClosed?: boolean;
};

/** Data barber yang dibutuhkan evaluator (subset kolom `barbers` + join staff). */
export type BarberSnapshot = {
  id: string;
  live_status: string | null;
  approval_status: string | null;
  /** Hasil join `staff_users.is_active AND deleted_at IS NULL` (E3). */
  staff_active: boolean;
};

/** Baris appointment yang dibutuhkan untuk menghitung blok okupansi. */
export type AppointmentSnapshot = {
  id?: string;
  barber_id?: string | null;
  status?: string | null;
  scheduled_at: Date | string | null;
  scheduled_end_at?: Date | string | null;
  schedule_block_start_at?: Date | string | null;
  schedule_block_end_at?: Date | string | null;
};

/** Segala yang perlu diketahui untuk memutuskan satu barber pada satu waktu. */
export type BarberEvaluationInput = {
  barber: BarberSnapshot;
  /** Blok okupansi yang diminta order baru ini. */
  requestedBlock: TimeRange;
  /** Jumlah order aktif barber pada hari itu — LINTAS CABANG (E7). */
  dayOrderCount: number;
  /** Blok okupansi order barber ini yang sudah ada. */
  existingBlocks: TimeRange[];
  /** Rentang cuti barber yang disetujui/aktif. */
  timeOff: TimeRange[];
  /** Hasil `OpenOrderService.isBarberOpen` untuk jam yang diminta. */
  isOpenOrder: boolean;
  /** Untuk home_service: apakah barber melayani koordinat tujuan. */
  withinRadius?: boolean;
};
