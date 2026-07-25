/**
 * SUMBER KEBENARAN TUNGGAL tahapan pesanan (stepper) untuk SELURUH klien.
 *
 * Sebelum modul ini, tahapan diturunkan ulang di tiga tempat dengan kamus yang
 * berbeda: `STATUS_ALIASES` (lifecycle), `BARBER_STATUS_ALIASES` (serializer
 * barber), dan `switch (appt.status)` di aplikasi customer. Akibatnya
 * `journey_status` (barber sedang menuju lokasi) dan status pembayaran tidak
 * pernah muncul di stepper customer, dan status terminal (batal/ditolak/no-show)
 * jatuh ke cabang `default` sehingga tampil seolah pesanan baru dibuat.
 *
 * Aturan di sini adalah satu-satunya tempat tahapan boleh ditentukan. Klien
 * hanya merender apa yang dikirim: daftar langkah, langkah yang sudah tercapai,
 * dan waktu pencapaiannya.
 *
 * Semantik `index`: **indeks langkah terakhir yang SUDAH tercapai**.
 *   - `i <  index` → langkah selesai
 *   - `i == index` → langkah yang sedang berjalan
 *   - `i >  index` → langkah belum tercapai
 *   - `index == -1` → belum ada langkah yang tercapai (mis. menunggu pembayaran)
 */

export type OrderStageKey =
  | 'awaiting_payment'
  | 'awaiting_acceptance'
  | 'accepted'
  | 'en_route'
  | 'arrived'
  | 'in_queue'
  | 'in_service'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'no_show'
  | 'expired';

/** Kunci langkah kanonik. Nama ikon dipetakan oleh masing-masing klien. */
export type OrderStepKey =
  | 'payment'
  | 'confirmed'
  | 'en_route'
  | 'arrived'
  | 'queue'
  | 'service'
  | 'done';

export type OrderStageStep = {
  key: OrderStepKey;
  label: string;
  /** Nama ikon kanonik; klien memetakannya ke ikon platform masing-masing. */
  icon: string;
  /** Waktu langkah ini tercapai (format sama dengan kolom datetime lain). */
  done_at: string | null;
};

export type OrderStage = {
  key: OrderStageKey;
  /** Indeks langkah terakhir yang sudah tercapai; -1 bila belum ada. */
  index: number;
  /** Kemajuan 0..1 pada penghubung SETELAH langkah aktif (mis. sudah check-in). */
  progress: number;
  /** Pesanan sudah berakhir (selesai maupun gagal). */
  terminal: boolean;
  /** Pesanan berakhir TANPA layanan (batal/ditolak/no-show/kedaluwarsa). */
  failed: boolean;
  /** Indeks langkah yang gagal dicapai; null bila tidak gagal. */
  failed_index: number | null;
  /** Ringkasan satu baris — dipakai klien lama & pemberitahuan. */
  label: string;
  steps: OrderStageStep[];
};

export type StageInput = {
  status: string;
  journey_status?: string | null;
  payment_status?: string | null;
  fulfillment_type?: string | null;
  source?: string | null;
  checked_in_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  /** Waktu transisi per status dari `appointment_events` (opsional). */
  status_timestamps?: Partial<Record<string, string | null>> | null;
  /** Waktu pembayaran lunas dari baris payment (opsional). */
  paid_at?: string | null;
};

const FAILED_STATUSES = new Set(['cancelled', 'no_show', 'rejected', 'expired', 'refunded']);

const STEP_ICONS: Record<OrderStepKey, string> = {
  payment: 'payment',
  confirmed: 'confirm',
  en_route: 'navigation',
  arrived: 'pin',
  queue: 'queue',
  service: 'scissors',
  done: 'done'
};

const STEP_LABELS: Record<OrderStepKey, string> = {
  payment: 'Bayar',
  confirmed: 'Dikonfirmasi',
  en_route: 'Menuju Lokasi',
  arrived: 'Tiba',
  queue: 'Antrean',
  service: 'Dilayani',
  done: 'Selesai'
};

const isHomeService = (input: StageInput) => input.fulfillment_type === 'home_service';

/**
 * Langkah "Bayar" hanya berlaku untuk order online — order walk-in dicatat admin
 * di lokasi dan dibayar tunai, jadi menampilkan langkah pembayaran di sana justru
 * menyesatkan.
 */
const hasPaymentStep = (input: StageInput) => (input.source ?? 'online_booking') === 'online_booking';

/** Urutan langkah untuk sebuah pesanan; satu-satunya kamus tahapan. */
export const buildStepKeys = (input: StageInput): OrderStepKey[] => {
  const steps: OrderStepKey[] = [];
  if (hasPaymentStep(input)) steps.push('payment');
  steps.push('confirmed');
  if (isHomeService(input)) {
    steps.push('en_route', 'arrived');
  } else {
    steps.push('queue');
  }
  steps.push('service', 'done');
  return steps;
};

/**
 * Turunkan tahap kanonik dari keadaan pesanan.
 *
 * Urutan evaluasi disengaja: status terminal lebih dulu (agar pesanan batal tidak
 * pernah terbaca sebagai "menunggu"), lalu gerbang pembayaran, lalu perjalanan
 * barber (`journey_status`), baru status appointment.
 */
export const resolveStageKey = (input: StageInput): OrderStageKey => {
  const status = (input.status ?? '').trim();
  const journey = (input.journey_status ?? 'not_started').trim();
  const paid = (input.payment_status ?? '') === 'paid';

  if (FAILED_STATUSES.has(status)) {
    return status === 'no_show'
      ? 'no_show'
      : status === 'expired'
        ? 'expired'
        : status === 'rejected'
          ? 'rejected'
          : 'cancelled';
  }
  if (status === 'completed') return 'completed';
  if (status === 'in_service') return 'in_service';
  if (status === 'in_queue') return isHomeService(input) ? 'arrived' : 'in_queue';
  if (status === 'confirmed') {
    // Barber sudah menekan "Menuju Lokasi": status appointment TETAP `confirmed`,
    // hanya journey_status yang berubah. Tanpa cabang ini stepper diam di
    // "Dikonfirmasi" selama barber di jalan.
    return journey === 'en_route' && isHomeService(input) ? 'en_route' : 'accepted';
  }
  // `pending`: bedakan menunggu bayar vs menunggu barber menerima. Order walk-in
  // tidak melewati gerbang pembayaran online.
  if (!paid && hasPaymentStep(input)) return 'awaiting_payment';
  return 'awaiting_acceptance';
};

/** Langkah terakhir yang tercapai untuk sebuah tahap (sebelum kegagalan). */
const reachedStepFor = (stageKey: OrderStageKey, input: StageInput): OrderStepKey | null => {
  switch (stageKey) {
    case 'awaiting_payment':
      return null;
    case 'awaiting_acceptance':
      return hasPaymentStep(input) ? 'payment' : null;
    case 'accepted':
      return 'confirmed';
    case 'en_route':
      return 'en_route';
    case 'arrived':
      return 'arrived';
    case 'in_queue':
      return 'queue';
    case 'in_service':
      return 'service';
    case 'completed':
      return 'done';
    default:
      return null;
  }
};

/**
 * Untuk pesanan yang gagal, tentukan sejauh mana ia sempat berjalan dari jejak
 * waktu yang tersisa. Tanpa ini seluruh pesanan batal terlihat sama — batal
 * sebelum dibayar dan batal saat sedang dilayani tampil identik.
 */
const reachedStepForFailed = (input: StageInput): OrderStepKey | null => {
  const ts = input.status_timestamps ?? {};
  if (input.started_at || ts.in_service) return 'service';
  if (input.checked_in_at || ts.in_queue) return isHomeService(input) ? 'arrived' : 'queue';
  if (ts.confirmed) return 'confirmed';
  if ((input.payment_status ?? '') === 'paid' && hasPaymentStep(input)) return 'payment';
  return null;
};

const doneAtFor = (step: OrderStepKey, input: StageInput): string | null => {
  const ts = input.status_timestamps ?? {};
  switch (step) {
    case 'payment':
      return input.paid_at ?? null;
    case 'confirmed':
      return ts.confirmed ?? null;
    case 'en_route':
      // journey_status tidak punya kolom waktu sendiri; biarkan null agar klien
      // tidak menampilkan jam yang tidak dapat dipertanggungjawabkan.
      return null;
    case 'arrived':
    case 'queue':
      return input.checked_in_at ?? ts.in_queue ?? null;
    case 'service':
      return input.started_at ?? ts.in_service ?? null;
    case 'done':
      return input.completed_at ?? ts.completed ?? null;
    default:
      return null;
  }
};

const STAGE_LABELS: Record<OrderStageKey, string> = {
  awaiting_payment: 'Menunggu pembayaran',
  awaiting_acceptance: 'Menunggu konfirmasi barber',
  accepted: 'Pesanan dikonfirmasi',
  en_route: 'Barber menuju lokasi',
  arrived: 'Barber sudah tiba',
  in_queue: 'Dalam antrean',
  in_service: 'Sedang dilayani',
  completed: 'Layanan selesai',
  cancelled: 'Pesanan dibatalkan',
  rejected: 'Pesanan ditolak',
  no_show: 'Tidak hadir',
  expired: 'Pesanan kedaluwarsa'
};

/**
 * Kemajuan parsial pada penghubung setelah langkah aktif.
 *
 * Satu-satunya keadaan antara yang benar-benar diketahui backend: customer sudah
 * check-in (`checked_in_at` terisi) tetapi barber belum memasukkannya ke antrean.
 * Menampilkannya sebagai setengah langkah membuat check-in terasa berdampak
 * tanpa mengubah kebijakan siapa yang berhak mengubah status.
 */
const resolveProgress = (stageKey: OrderStageKey, input: StageInput): number => {
  if (stageKey === 'accepted' && !isHomeService(input) && input.checked_in_at) return 0.5;
  return 0;
};

export const resolveOrderStage = (input: StageInput): OrderStage => {
  const stepKeys = buildStepKeys(input);
  const stageKey = resolveStageKey(input);
  const failed = FAILED_STATUSES.has((input.status ?? '').trim());
  const terminal = failed || stageKey === 'completed';

  const reached = failed ? reachedStepForFailed(input) : reachedStepFor(stageKey, input);
  const index = reached ? stepKeys.indexOf(reached) : -1;

  const steps: OrderStageStep[] = stepKeys.map((key, i) => ({
    key,
    label: STEP_LABELS[key],
    icon: STEP_ICONS[key],
    done_at: i <= index ? doneAtFor(key, input) : null
  }));

  return {
    key: stageKey,
    index,
    progress: failed ? 0 : resolveProgress(stageKey, input),
    terminal,
    failed,
    // Langkah yang gagal dicapai = langkah tepat setelah yang terakhir tercapai.
    failed_index: failed ? Math.min(index + 1, stepKeys.length - 1) : null,
    label: STAGE_LABELS[stageKey] ?? stageKey,
    steps
  };
};

/**
 * Alias status untuk klien lama (dipakai payload socket & respons aksi barber).
 * Disatukan di sini agar tidak ada lagi dua kamus yang bisa melenceng.
 */
export const CUSTOMER_STATUS_ALIASES: Record<string, string> = {
  pending: 'pending',
  confirmed: 'accepted',
  in_queue: 'arrived',
  in_service: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show'
};
