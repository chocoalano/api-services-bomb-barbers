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

const parseNonNegativeInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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
   * Nilai di sini SUDAH kanonik — bandingkan lewat `isIdleLiveStatus()` agar
   * baris lama bernilai 'online' ikut dinormalkan (lihat BARBER_LIVE_STATUSES).
   */
  idleBarberStatuses: ['available'] as string[],
  /**
   * Bila true, barber HANYA tersedia pada periode yang sudah ia buka Open Order-nya
   * (spec §11.3, strict). Bila false (default), barber tanpa satupun record Open
   * Order pada tanggal itu dianggap open untuk seluruh jam operasional (backward
   * compatible), sedangkan barber yang punya record dibatasi ke periode tsb.
   */
  requireOpenOrder: String(process.env.BOOKING_REQUIRE_OPEN_ORDER || '').toLowerCase() === 'true',
  /**
   * Bila true (default), seorang customer BOLEH memiliki lebih dari satu order
   * aktif pada tanggal & jam yang sama. Jumlah maksimalnya dibatasi oleh
   * kapasitas barber idle+online (tiap order memakai barber berbeda; saat semua
   * barber idle terpakai backend melempar NO_BARBER_AVAILABLE). Bila false,
   * kembali ke perilaku lama: satu order per customer per blok 2 jam
   * (CUSTOMER_DOUBLE_BOOKING). Override via env
   * BOOKING_ALLOW_CUSTOMER_CONCURRENT_ORDERS=false.
   */
  allowCustomerConcurrentOrders:
    String(process.env.BOOKING_ALLOW_CUSTOMER_CONCURRENT_ORDERS ?? 'true').toLowerCase() !== 'false',
  /**
   * Jeda minimal (menit) antara waktu SEKARANG dan jam booking yang dipilih
   * customer. Customer yang membuka aplikasi pukul 08:00 hanya boleh memilih
   * 14:00 ke atas. Batas bersifat inklusif: slot tepat pada now+6 jam boleh.
   * Hanya berlaku untuk booking online berjadwal — order on-demand/ASAP dan
   * order walk-in yang dibuat admin di lokasi tidak dibatasi.
   * Override via env BOOKING_MIN_LEAD_MINUTES.
   */
  minCustomerLeadMinutes: parsePositiveInt(process.env.BOOKING_MIN_LEAD_MINUTES, 6 * 60),
  /**
   * Batas offset hari (relatif "sekarang" WIB) di mana jeda minimal MASIH
   * berlaku. 0 = hanya hari ini; 1 = hari ini & besok (default, keputusan klien
   * 2026-07-22). Slot pada tanggal dengan offset LEBIH BESAR dari nilai ini
   * bebas dari jeda minimal — customer boleh memilih jam berapa pun.
   *
   * Contoh (lead 6 jam, jam 08:00–22:00): order tgl 22 pukul 22:00 untuk tgl 23
   * pukul 08:00 → offset 1 → jeda tetap dicek (dan lolos, selisih 10 jam).
   * Order untuk tgl 24 (lusa) → offset 2 → jeda TIDAK berlaku.
   * Override via env BOOKING_MIN_LEAD_MAX_DAY_OFFSET.
   */
  minLeadMaxDayOffset: parseNonNegativeInt(process.env.BOOKING_MIN_LEAD_MAX_DAY_OFFSET, 1)
} as const;

// ============================================================================
// [E8] KAMUS STATUS KEHADIRAN BARBER — SATU-SATUNYA YANG SAH
// ----------------------------------------------------------------------------
// Sebelumnya ada tiga kamus yang tidak beririsan: app barber
// (online|offline|unavailable), app admin (available|serving|on_break|offline),
// dan lifecycle otomatis yang menulis serving/available HANYA ke Redis.
// Akibatnya barber yang di-on_break admin tetap melihat switch-nya ON, dan
// barber yang sedang melayani tetap dianggap idle oleh booking.
//
// Keputusan klien 2026-07-21: DB `barbers.live_status` adalah sumber kebenaran,
// Redis murni cache. Kamus kanonik = kamus admin; nilai app barber dipetakan.
// ============================================================================

export const BARBER_LIVE_STATUSES = ['available', 'serving', 'on_break', 'offline'] as const;
export type BarberLiveStatus = (typeof BARBER_LIVE_STATUSES)[number];

/** Alias historis → kamus kanonik. `online ≡ available`, `unavailable ≡ on_break`. */
const LIVE_STATUS_ALIASES: Record<string, BarberLiveStatus> = {
  online: 'available',
  available: 'available',
  serving: 'serving',
  busy: 'serving',
  unavailable: 'on_break',
  on_break: 'on_break',
  break: 'on_break',
  offline: 'offline'
};

/**
 * Normalkan nilai `live_status` dari sumber mana pun ke kamus kanonik.
 * Nilai tak dikenal → 'offline' (fail-closed: jangan menawarkan barber yang
 * statusnya tidak bisa dipastikan).
 */
export const normalizeLiveStatus = (raw: string | null | undefined): BarberLiveStatus =>
  LIVE_STATUS_ALIASES[String(raw ?? '').trim().toLowerCase()] ?? 'offline';

/** true bila barber siap menerima order baru (setelah normalisasi). */
export const isIdleLiveStatus = (raw: string | null | undefined): boolean =>
  BOOKING_CONFIG.idleBarberStatuses.includes(normalizeLiveStatus(raw));

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

// [D2/R2/R3] Batas jam (buka/tutup) kini mengikuti cabang. Fungsi grid menerima
// `openMin`/`closeMin` opsional; default = konstanta config (08:00–22:00) demi
// kompatibilitas — cabang default menghasilkan grid yang identik dengan sebelumnya.

/**
 * Slot Open Order barber: kelipatan 2 jam dari jam buka cabang sampai jam tutup
 * (inklusif). Anchor kelipatan dihitung dari `openMin`. Untuk cabang default
 * 08:00–22:00 → 08:00, 10:00, …, 22:00 (identik dengan sebelumnya).
 */
export const generateBarberOpenOrderSlots = (
  _date?: string,
  openMin: number = BOOKING_CONFIG.operationalStartMinutes,
  closeMin: number = BOOKING_CONFIG.operationalLastBookingMinutes
): string[] => {
  const slots: string[] = [];
  for (let m = openMin; m <= closeMin; m += BOOKING_CONFIG.barberOpenOrderIntervalMinutes) {
    slots.push(minutesToTime(m));
  }
  return slots;
};

/**
 * Slot booking customer: kelipatan 1 jam dari jam buka sampai jam tutup cabang
 * (inklusif). Untuk cabang default 08:00–22:00 → 08:00 … 22:00.
 */
export const generateCustomerBookingSlots = (
  _date?: string,
  openMin: number = BOOKING_CONFIG.operationalStartMinutes,
  closeMin: number = BOOKING_CONFIG.operationalLastBookingMinutes
): string[] => {
  const slots: string[] = [];
  for (let m = openMin; m <= closeMin; m += BOOKING_CONFIG.customerBookingIntervalMinutes) {
    slots.push(minutesToTime(m));
  }
  return slots;
};

/**
 * [R2] Valid bila time jatuh pada jam bulat (kelipatan interval booking customer).
 * Batas buka/tutup TIDAK lagi dicek di sini — itu tugas jam operasional cabang
 * (`fitsOperatingWindow`), sehingga cabang yang buka <08:00 atau tutup >22:00
 * tetap konsisten antara generator slot dan pre-flight.
 */
export const isValidCustomerBookingSlot = (time: string): boolean => {
  let minutes: number;
  try {
    minutes = timeToMinutes(time);
  } catch {
    return false;
  }
  return (
    minutes >= 0 &&
    minutes < 24 * 60 &&
    minutes % BOOKING_CONFIG.customerBookingIntervalMinutes === 0
  );
};

/**
 * Valid bila time termasuk slot Open Order barber (kelipatan 2 jam) dalam jam
 * operasional cabang. Anchor dihitung dari `openMin`.
 */
export const isValidBarberOpenOrderSlot = (
  time: string,
  openMin: number = BOOKING_CONFIG.operationalStartMinutes,
  closeMin: number = BOOKING_CONFIG.operationalLastBookingMinutes
): boolean => {
  let minutes: number;
  try {
    minutes = timeToMinutes(time);
  } catch {
    return false;
  }
  return (
    minutes >= openMin &&
    minutes <= closeMin &&
    (minutes - openMin) % BOOKING_CONFIG.barberOpenOrderIntervalMinutes === 0
  );
};

/**
 * Mapping jam booking customer → periode Open Order barber yang mencakupnya.
 * Periode Open Order 2 jam di-anchor ke `openMin`: untuk cabang default 08:00,
 * 08:00 mencakup 08:00 & 09:00, dst. Mengembalikan 'HH:MM' periode, atau null
 * bila jam booking bukan slot customer valid / di luar jam operasional cabang.
 */
export const getOpenOrderPeriodForCustomerSlot = (
  bookingTime: string,
  openMin: number = BOOKING_CONFIG.operationalStartMinutes,
  closeMin: number = BOOKING_CONFIG.operationalLastBookingMinutes
): string | null => {
  if (!isValidCustomerBookingSlot(bookingTime)) return null;
  const minutes = timeToMinutes(bookingTime);
  if (minutes < openMin || minutes > closeMin) return null;
  const offset = minutes - openMin;
  const periodOffset = offset - (offset % BOOKING_CONFIG.barberOpenOrderIntervalMinutes);
  return minutesToTime(openMin + periodOffset);
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

/**
 * Instant paling awal yang boleh dipilih customer = now + jeda minimal.
 * Dipakai oleh generator slot (memfilter jam yang terlalu dekat) dan oleh
 * validator saat order dibuat/diubah. Nilai ini TIDAK sadar-tanggal; gunakan
 * `minLeadAppliesTo` untuk menentukan apakah jeda berlaku pada slot tertentu.
 */
export const earliestBookableAt = (now: Date = new Date()): Date =>
  addMinutes(now, BOOKING_CONFIG.minCustomerLeadMinutes);

/**
 * Selisih hari KALENDER WIB antara `target` dan `now` (target − now).
 * Hari ini → 0, besok → 1, kemarin → -1. Perbandingan pada tanggal kalender
 * WIB (bukan selisih 24 jam) agar batas hari konsisten dengan slot booking.
 */
export const jakartaDayOffset = (target: Date, now: Date = new Date()): number => {
  const toUtcMidnight = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const nowDay = toUtcMidnight(jakartaParts(now).date);
  const targetDay = toUtcMidnight(jakartaParts(target).date);
  return Math.round((targetDay - nowDay) / 86_400_000);
};

/**
 * true bila jeda minimal berlaku untuk slot yang mulai pada `slotStart`
 * (day-scoped, keputusan klien 2026-07-22). H+0/H+1 → berlaku; H+2+ bebas.
 */
export const minLeadAppliesTo = (slotStart: Date, now: Date = new Date()): boolean =>
  jakartaDayOffset(slotStart, now) <= BOOKING_CONFIG.minLeadMaxDayOffset;

/**
 * Instant paling awal yang boleh dipilih UNTUK slot pada `slotStart`.
 * H+0/H+1 → now + jeda minimal. H+2+ → null (tidak dibatasi jeda).
 * Dipakai generator & response `min_bookable_at` agar sadar-tanggal.
 */
export const earliestBookableForSlot = (
  slotStart: Date,
  now: Date = new Date()
): Date | null => (minLeadAppliesTo(slotStart, now) ? earliestBookableAt(now) : null);

/**
 * true bila `slotStart` memenuhi jeda minimal terhadap `now` (inklusif).
 * Untuk slot H+2 ke atas jeda TIDAK berlaku sehingga selalu true (day-scoped).
 * Untuk H+0/H+1 perbandingan bersifat ketat terhadap menit: pada pukul 08:07
 * slot 14:00 sudah lewat batas (08:07+6j = 14:07), sehingga slot valid pertama
 * adalah 15:00.
 */
export const satisfiesMinLead = (slotStart: Date, now: Date = new Date()): boolean => {
  if (!minLeadAppliesTo(slotStart, now)) return true;
  return slotStart.getTime() >= earliestBookableAt(now).getTime();
};

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
