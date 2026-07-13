// ============================================================================
// KONFIGURASI & HELPER BOOKING BARBER — SATU-SATUNYA SUMBER KEBENARAN
// ----------------------------------------------------------------------------
// Semua aturan bisnis booking (jam operasional, interval slot, kuota harian,
// durasi layanan default, status aktif) didefinisikan di sini agar tidak
// tersebar hardcode di banyak tempat. Service lain WAJIB mengimpor dari modul
// ini, bukan mendefinisikan ulang konstanta yang sama.
//
// Istilah resmi: Barber, Customer, Booking, Open Order, Lokasi tujuan.
// Dilarang: Kepster, Kang Cukur, Lokasi penjemputan.
// ============================================================================

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// --- Konfigurasi utama (dapat di-override via env) --------------------------
export const BOOKING_CONFIG = {
  /** Jam awal order (menit-dalam-hari). 08:00. */
  operationalStartMinutes: 8 * 60,
  /** Slot order terakhir yang boleh dipilih customer (inklusif). 22:00. */
  operationalLastBookingMinutes: 22 * 60,
  /** Interval slot Open Order barber (kelipatan 2 jam). */
  barberOpenOrderIntervalMinutes: 2 * 60,
  /** Interval slot booking customer (kelipatan 1 jam). */
  customerBookingIntervalMinutes: 60,
  /** Maksimal order aktif per barber per hari. */
  maxDailyOrdersPerBarber: parsePositiveInt(process.env.MAX_ORDERS_PER_BARBER_PER_DAY, 7),
  /** Durasi layanan default (menit) bila tidak diketahui. */
  defaultServiceDurationMinutes: 60,
  /**
   * Blok waktu yang ditempati setiap order pada barber (menit). Order menempati
   * minimal 2 jam agar satu barber tidak menerima 2 order yang bentrok.
   */
  barberBlockMinutes: 120,
  /** Timezone project. */
  timezone: 'Asia/Jakarta',
  /** Offset numerik timezone project (untuk konstruksi Date dari tanggal lokal). */
  timezoneOffset: '+07:00',
  /**
   * live_status barber yang dianggap "idle"/siap menerima order (Open Order aktif
   * = barber hadir/online). Hanya barber idle yang ditawarkan ke customer.
   */
  idleBarberStatuses: ['online', 'available'] as string[],
  /**
   * Bila true, barber HANYA tersedia pada periode yang sudah ia buka Open Order-nya
   * (spec §11.3, strict). Bila false (default), barber tanpa satupun record Open
   * Order pada tanggal itu dianggap open untuk seluruh jam operasional (backward
   * compatible), sedangkan barber yang punya record dibatasi ke periode tsb.
   */
  requireOpenOrder: String(process.env.BOOKING_REQUIRE_OPEN_ORDER || '').toLowerCase() === 'true'
} as const;

/**
 * Status appointment yang dianggap AKTIF untuk pengecekan bentrok jadwal
 * (customer & barber). Sesuaikan dengan enum appointment_status project:
 * pending, confirmed, in_queue, in_service, completed, cancelled, no_show.
 */
export const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'] as const;

/**
 * Status yang TIDAK dihitung sebagai order aktif untuk kuota harian barber.
 * (Semua status selain ini dihitung, termasuk `completed`.)
 */
export const INACTIVE_APPOINTMENT_STATUSES = ['cancelled', 'no_show'] as const;

// ============================================================================
// HELPER WAKTU (murni, tanpa efek samping / tanpa DB)
// ============================================================================

/** Ubah 'HH:MM' atau 'HH:MM:SS' → menit-dalam-hari. */
export const timeToMinutes = (time: string): number => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) throw new Error(`Format waktu tidak valid: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
};

/** Ubah menit-dalam-hari → 'HH:MM' (24 jam). */
export const minutesToTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// ============================================================================
// GENERATOR & VALIDATOR SLOT (spec §15 & §16)
// ============================================================================

/**
 * Slot Open Order barber: kelipatan 2 jam dari 08:00 sampai 22:00 inklusif.
 * → 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00. Tidak menghasilkan 23:00/24:00.
 * Parameter `date` diterima untuk konsistensi signature (jam operasional tetap sama tiap hari).
 */
export const generateBarberOpenOrderSlots = (_date?: string): string[] => {
  const slots: string[] = [];
  for (
    let m = BOOKING_CONFIG.operationalStartMinutes;
    m <= BOOKING_CONFIG.operationalLastBookingMinutes;
    m += BOOKING_CONFIG.barberOpenOrderIntervalMinutes
  ) {
    slots.push(minutesToTime(m));
  }
  return slots;
};

/**
 * Slot booking customer: kelipatan 1 jam dari 08:00 sampai 22:00 inklusif.
 * → 08:00 … 22:00. Tidak menghasilkan 23:00.
 */
export const generateCustomerBookingSlots = (_date?: string): string[] => {
  const slots: string[] = [];
  for (
    let m = BOOKING_CONFIG.operationalStartMinutes;
    m <= BOOKING_CONFIG.operationalLastBookingMinutes;
    m += BOOKING_CONFIG.customerBookingIntervalMinutes
  ) {
    slots.push(minutesToTime(m));
  }
  return slots;
};

/**
 * Valid bila: 08:00 <= time <= 22:00 DAN menit == 00 (jam penuh).
 * Tidak mengecek apakah waktu selesai layanan melewati 22:00 (spec §3.6, §16).
 */
export const isValidCustomerBookingSlot = (time: string): boolean => {
  let minutes: number;
  try {
    minutes = timeToMinutes(time);
  } catch {
    return false;
  }
  return (
    minutes >= BOOKING_CONFIG.operationalStartMinutes &&
    minutes <= BOOKING_CONFIG.operationalLastBookingMinutes &&
    minutes % BOOKING_CONFIG.customerBookingIntervalMinutes === 0
  );
};

/** Valid bila time termasuk slot Open Order barber (kelipatan 2 jam, 08:00–22:00). */
export const isValidBarberOpenOrderSlot = (time: string): boolean => {
  let minutes: number;
  try {
    minutes = timeToMinutes(time);
  } catch {
    return false;
  }
  return (
    minutes >= BOOKING_CONFIG.operationalStartMinutes &&
    minutes <= BOOKING_CONFIG.operationalLastBookingMinutes &&
    (minutes - BOOKING_CONFIG.operationalStartMinutes) % BOOKING_CONFIG.barberOpenOrderIntervalMinutes === 0
  );
};

/**
 * Mapping jam booking customer → periode Open Order barber yang mencakupnya.
 * Periode Open Order 2 jam: 08:00 mencakup 08:00 & 09:00, dst. 22:00 hanya 22:00.
 * Mengembalikan 'HH:MM' periode, atau null bila jam booking bukan slot customer valid.
 *   08:00→08:00, 09:00→08:00, 10:00→10:00, 11:00→10:00, … 20:00→20:00, 21:00→20:00, 22:00→22:00.
 */
export const getOpenOrderPeriodForCustomerSlot = (bookingTime: string): string | null => {
  if (!isValidCustomerBookingSlot(bookingTime)) return null;
  const minutes = timeToMinutes(bookingTime);
  const offset = minutes - BOOKING_CONFIG.operationalStartMinutes;
  const periodOffset = offset - (offset % BOOKING_CONFIG.barberOpenOrderIntervalMinutes);
  return minutesToTime(BOOKING_CONFIG.operationalStartMinutes + periodOffset);
};

// ============================================================================
// HELPER RENTANG WAKTU (murni)
// ============================================================================

/** Gabungkan tanggal (YYYY-MM-DD) + jam (HH:MM[:SS]) pada timezone project → Date. */
export const combineDateTime = (date: string, time: string): Date => {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${normalized}${BOOKING_CONFIG.timezoneOffset}`);
};

export const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);

/** true bila rentang [startA,endA) dan [startB,endB) saling bertumpuk. */
export const overlaps = (startA: Date, endA: Date, startB: Date, endB: Date): boolean =>
  startA < endB && endA > startB;

/** Ekstrak tanggal (YYYY-MM-DD) & menit-dalam-hari pada timezone project. */
export const jakartaParts = (date: Date): { date: string; minutes: number } => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: BOOKING_CONFIG.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const hour = Number(parts.hour) % 24; // sebagian runtime memakai '24' untuk tengah malam
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute)
  };
};
