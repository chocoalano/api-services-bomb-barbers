import { randomUUID } from 'crypto';
import { db } from '../../lib/db';
import { snakeKeys, toDbDate } from '../../db/helpers';
import { appointments, barbers, services, payments, appointmentServices, appointmentEvents, customers, branches, reviews } from '../../db/schema';
import { and, or, eq, ne, inArray, notInArray, gte, lte, lt, desc, asc, isNull, sql, type SQL } from 'drizzle-orm';
import { asRpcResult, parseDbTime } from '../../db/procedures';
import { createAppointmentAtomic } from '../../db/appointment-procedures';
import { scheduleAppointmentTimeouts, scheduleAppointmentReminder, UNPAID_ORDER_EXPIRY_MINUTES } from '../../lib/queue';
import { getTrackingRouteKey, redis } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { io, emitNewOrder } from '../../lib/socket';
import { AppointmentLifecycleService } from './lifecycle.service';
import { OpenOrderService } from './open-order.service';
import {
  BranchServiceAreaService,
  normalizeLocation
} from '../branches/service-area.service';
import {
  BOOKING_CONFIG,
  jakartaParts as configJakartaParts
} from '../../config/booking';

type CreatePayload = {
  branch_id: string;
  barber_id?: string | null;
  customer_id?: string | null;
  service_ids: string[];
  scheduled_at?: string;
  media_urls?: string[];
  fulfillment_type?: 'in_store' | 'home_service';
  service_address?: string;
  destination_latitude?: number;
  destination_longitude?: number;
  location_notes?: string;
  idempotency_key: string;
};

export type AppointmentActor = {
  type: 'customer' | 'staff' | 'system';
  id: string | null;
  role: 'customer' | 'barber' | 'admin' | 'system';
};

type CustomerAppointmentsQuery = {
  status?: string[] | string;
  ongoing_only?: boolean | string;
  limit?: number | string;
  page?: number | string;
  before?: string;
};

const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];
const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'in_queue',
  'in_service',
  'completed',
  'cancelled',
  'no_show'
];
const STATUS_ALIASES: Record<string, string[]> = {
  waiting: ['pending', 'confirmed', 'in_queue'],
  in_process: ['in_service'],
  ongoing: ACTIVE_APPOINTMENT_STATUSES
};
const DEFAULT_CUSTOMER_APPOINTMENT_LIMIT = 10;
const MAX_CUSTOMER_APPOINTMENT_LIMIT = 100;
export const BARBER_QUEUE_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];
const BARBER_STATUS_ALIASES: Record<string, string> = {
  pending: 'pending',
  confirmed: 'accepted',
  in_queue: 'accepted',
  in_service: 'in_progress'
};

const normalizeBoolean = (value: boolean | string | undefined) => {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes'].includes(value.toLowerCase());
};

const normalizeLimit = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') return DEFAULT_CUSTOMER_APPOINTMENT_LIMIT;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter limit harus berupa angka minimal 1');
  }

  return Math.min(Math.floor(parsed), MAX_CUSTOMER_APPOINTMENT_LIMIT);
};

const normalizePage = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') return 1;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter page harus berupa angka minimal 1');
  }

  return Math.floor(parsed);
};

const normalizeStatusFilter = (value: string[] | string | undefined) => {
  if (!value) return [];

  const rawStatuses = (Array.isArray(value) ? value : value.split(','))
    .flatMap((item) => item.split(','))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const statuses = new Set<string>();
  for (const status of rawStatuses) {
    if (STATUS_ALIASES[status]) {
      STATUS_ALIASES[status].forEach((mappedStatus) => statuses.add(mappedStatus));
      continue;
    }

    if (!APPOINTMENT_STATUSES.includes(status)) {
      throw new Error(`Status appointment tidak valid: ${status}`);
    }

    statuses.add(status);
  }

  return Array.from(statuses);
};

const normalizeBefore = (value?: string) => {
  if (!value) return null;
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('Parameter before harus berupa timestamp ISO yang valid');
  }

  return value;
};

const mapOngoingStatus = (status: string) => {
  if (['pending', 'confirmed', 'in_queue'].includes(status)) return 'waiting';
  if (status === 'in_service') return 'in_process';
  return null;
};

const unwrapRelation = (value: any) => Array.isArray(value) ? value[0] : value;

const toNumberOrNull = (value: any) => {
  if (value === undefined || value === null || value === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildLocation = (lat: any, lng: any) => {
  const latitude = toNumberOrNull(lat);
  const longitude = toNumberOrNull(lng);

  if (latitude === null || longitude === null || latitude === 0 || longitude === 0) {
    return null;
  }

  return { lat: latitude, lng: longitude };
};

const formatCustomerAppointment = (appointment: any) => {
  const branch = unwrapRelation(appointment.branches);
  const barber = unwrapRelation(appointment.barbers);
  // Review milik order ini (0/1 baris — dijamin unik oleh constraint). Dipakai
  // FE menampilkan bintang rating di riwayat order. null bila belum diulas.
  const review = unwrapRelation(appointment.reviews);
  const initialLocation = buildLocation(branch?.latitude, branch?.longitude);
  const appointmentServices = appointment.appointment_services ?? [];
  const services = appointmentServices.map((item: any) => {
    const service = unwrapRelation(item.services);

    return {
      id: item.service_id,
      name: service?.name ?? null,
      description: service?.description ?? null,
      image_url: service?.image_url ?? null,
      price: item.price_amount,
      price_amount: item.price_amount,
      duration_min: item.duration_min
    };
  });
  const items = services.map((service: any) => ({
    id: service.id,
    item_type: 'service',
    service_id: service.id,
    name: service.name,
    description: service.description,
    image_url: service.image_url,
    quantity: 1,
    unit_price: service.price_amount,
    price: service.price_amount,
    total_price: service.price_amount,
    duration_min: service.duration_min
  }));

  // Sumber kebenaran nominal tagihan ada di baris payment (subtotal + biaya
  // layanan + ongkir − diskon). Utamakan baris berstatus 'paid' agar tidak
  // tertutup attempt lama; fallback ke baris pertama, lalu ke subtotal layanan.
  const paymentsArr = Array.isArray(appointment.payments)
    ? appointment.payments
    : (appointment.payments ? [appointment.payments] : []);
  const paidPayment = paymentsArr.find((p: any) => p?.status === 'paid');
  const primaryPayment = paidPayment ?? paymentsArr[0] ?? null;
  const serviceSubtotal = items.reduce(
    (sum: number, item: any) => sum + Number(item.total_price || 0),
    0
  );
  const grandTotal =
    primaryPayment && primaryPayment.total_amount != null
      ? Number(primaryPayment.total_amount)
      : serviceSubtotal;

  return {
    id: appointment.id,
    branch_id: appointment.branch_id,
    barber_id: appointment.barber_id,
    customer_id: appointment.customer_id,
    source: appointment.source,
    status: appointment.status,
    ongoing_status: mapOngoingStatus(appointment.status),
    scheduled_at: appointment.scheduled_at,
    scheduled_end_at: appointment.scheduled_end_at ?? null,
    travel_buffer_min: appointment.travel_buffer_min ?? 0,
    queue_position: appointment.queue_position,
    checked_in_at: appointment.checked_in_at,
    started_at: appointment.started_at,
    completed_at: appointment.completed_at,
    cancellation_reason: appointment.cancellation_reason,
    customer_media_urls: appointment.customer_media_urls ?? [],
    fulfillment_type: appointment.fulfillment_type ?? 'in_store',
    service_address: appointment.service_address ?? null,
    destination_latitude: toNumberOrNull(appointment.destination_latitude),
    destination_longitude: toNumberOrNull(appointment.destination_longitude),
    destination_location: buildLocation(
      appointment.destination_latitude,
      appointment.destination_longitude
    ),
    location_notes: appointment.location_notes ?? null,
    journey_status: appointment.journey_status ?? 'not_started',
    version: appointment.version ?? 1,
    total_service_amount: serviceSubtotal,
    // total_price = subtotal layanan saja (dipertahankan demi kompatibilitas).
    total_price: serviceSubtotal,
    // grand_total = nominal yang benar-benar ditagihkan ke customer
    // (subtotal + biaya layanan + ongkir − diskon), sumbernya baris payment.
    // Fallback ke subtotal layanan bila payment belum dibuat.
    grand_total: grandTotal,
    service_fee: primaryPayment ? Number(primaryPayment.service_fee ?? 0) : 0,
    delivery_fee: primaryPayment ? Number(primaryPayment.delivery_fee ?? 0) : 0,
    discount_amount: primaryPayment ? Number(primaryPayment.discount_amount ?? 0) : 0,
    product_amount: primaryPayment ? Number(primaryPayment.product_amount ?? 0) : 0,
    tip_amount: primaryPayment ? Number(primaryPayment.tip_amount ?? 0) : 0,
    payment_method: primaryPayment?.method ?? null,
    // Rating & ulasan customer untuk order ini (null bila belum diulas).
    review: review ? {
      rating: review.rating ?? null,
      comment: review.comment ?? null
    } : null,
    rating: review?.rating ?? null,
    total_duration_min: items.reduce((sum: number, item: any) => sum + Number(item.duration_min || 0), 0),
    created_at: appointment.created_at,
    updated_at: appointment.updated_at,
    branch: branch ? {
      id: branch.id,
      name: branch.name,
      address: branch.address ?? null,
      latitude: toNumberOrNull(branch.latitude),
      longitude: toNumberOrNull(branch.longitude),
      location: initialLocation
    } : null,
    barber: barber ? {
      id: barber.id,
      full_name: barber.display_name,
      display_name: barber.display_name,
      rating_avg: barber.rating_avg ?? null,
      rating_count: barber.rating_count ?? null,
      latitude: initialLocation?.lat ?? null,
      longitude: initialLocation?.lng ?? null,
      location: initialLocation
    } : null,
    location: initialLocation,
    tracking_initial_location: initialLocation,
    barber_lat: initialLocation?.lat ?? null,
    barber_lng: initialLocation?.lng ?? null,
    barberLat: initialLocation?.lat ?? null,
    barberLng: initialLocation?.lng ?? null,
    services,
    items,
    appointment_services: appointmentServices,
    // Utamakan baris payment berstatus 'paid' bila ada, agar status lunas tidak
    // tertutup baris pembayaran lain (mis. attempt lama). Fallback ke baris pertama.
    payment_status: (paidPayment?.status ?? primaryPayment?.status) ?? 'unpaid'
  };
};

const formatJakartaTime = (value?: string | null) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta'
  }).format(date).replace('.', ':');
};

const readTrackingRoute = async (appointmentId: string) => {
  const raw = await redis.get(getTrackingRouteKey(appointmentId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

const formatDistance = (eta: any) => {
  const distanceKm = toNumberOrNull(eta?.distance_km ?? eta?.distanceKm);
  if (distanceKm !== null) {
    return `${distanceKm.toFixed(distanceKm % 1 === 0 ? 0 : 1)} km`;
  }

  if (typeof eta?.distance === 'string' && eta.distance.trim()) {
    return eta.distance.trim();
  }

  return 'Belum tersedia';
};

const formatEta = (appointment: any, eta: any) => {
  const etaMinutes = toNumberOrNull(eta?.eta_minutes ?? eta?.etaMinutes);
  if (etaMinutes !== null) {
    return `${Math.max(0, Math.round(etaMinutes))} menit`;
  }

  if (appointment.status === 'pending') return 'Menunggu respon';
  if (appointment.status === 'confirmed' || appointment.status === 'in_queue') return 'Menunggu jadwal';
  if (appointment.status === 'in_service') return 'Sedang dilayani';
  return 'Belum tersedia';
};

export const formatBarberQueueOrder = async (appointment: any) => {
  const customer = unwrapRelation(appointment.customers);
  const branch = unwrapRelation(appointment.branches);
  const appointmentServices = appointment.appointment_services ?? [];
  const serviceNames = appointmentServices
    .map((item: any) => unwrapRelation(item.services)?.name)
    .filter(Boolean);
  const price = appointmentServices.reduce(
    (sum: number, item: any) => sum + Number(item.price_amount || 0),
    0
  ) * 0.4;
  const route = await readTrackingRoute(appointment.id);

  const fulfillmentType = appointment.fulfillment_type ?? 'in_store';
  const isHomeService = fulfillmentType === 'home_service';
  const pickupAddress = isHomeService
    ? (appointment.service_address ?? null)
    : (branch?.address ?? null);

  const payment = unwrapRelation(appointment.payments);

  return {
    id: appointment.id,
    customer_name: customer?.full_name ?? 'Pelanggan walk-in',
    service_name: serviceNames.length > 0 ? serviceNames.join(' + ') : 'Layanan belum dipilih',
    price,
    distance: formatDistance(route),
    eta: formatEta(appointment, route),
    eta_minutes: toNumberOrNull(route?.eta_minutes) ?? null,
    distance_km: toNumberOrNull(route?.distance_km) ?? null,
    route,
    time: formatJakartaTime(appointment.scheduled_at || appointment.created_at),
    // Kirim jadwal mentah (ISO) agar FE bisa menampilkan tanggal + jam pada tiap
    // kartu order dan mengelompokkan "Orderan Saat Ini"/"Orderan Lainnya" per
    // tanggal booking. Tanpa ini FE hanya punya string jam (tanpa tanggal).
    scheduled_at: appointment.scheduled_at ?? null,
    address: pickupAddress ?? branch?.address ?? '',
    status: BARBER_STATUS_ALIASES[appointment.status] ?? appointment.status,
    raw_status: appointment.status,
    fulfillment_type: fulfillmentType,
    service_address: appointment.service_address ?? null,
    destination_location: buildLocation(appointment.destination_latitude, appointment.destination_longitude),
    location_notes: appointment.location_notes ?? null,
    customer_media_urls: appointment.customer_media_urls ?? [],
    journey_status: appointment.journey_status ?? 'not_started',
    payment_status: payment?.status ?? 'unpaid',
    payment_method: payment?.method ?? null,
    payment_id: payment?.id ?? null
  };
};

const BARBER_HISTORY_STATUSES = ['completed', 'cancelled', 'no_show'] as const;

const formatBarberHistoryOrder = (appointment: any) => {
  const customer = unwrapRelation(appointment.customers);
  const appointmentServices = appointment.appointment_services ?? [];
  const serviceNames = appointmentServices
    .map((item: any) => unwrapRelation(item.services)?.name)
    .filter(Boolean);
  const price = appointmentServices.reduce(
    (sum: number, item: any) => sum + Number(item.price_amount || 0),
    0
  ) * 0.4;

  return {
    id: appointment.id,
    customer_name: customer?.full_name ?? 'Pelanggan walk-in',
    service_name: serviceNames.length > 0 ? serviceNames.join(' + ') : 'Layanan belum dipilih',
    price,
    status: appointment.status,
    fulfillment_type: appointment.fulfillment_type ?? 'in_store',
    service_address: appointment.service_address ?? null,
    customer_media_urls: appointment.customer_media_urls ?? [],
    scheduled_at: appointment.scheduled_at ?? null,
    completed_at: appointment.completed_at ?? null,
    created_at: appointment.created_at
  };
};

// ============================================================================
// [SPEC BOOKING] Konfigurasi & helper operasional order
// ----------------------------------------------------------------------------
// Semua konstanta operasional berasal dari SATU sumber: src/config/booking.ts.
// - Jam kerja 08:00–22:00 (Asia/Jakarta); customer memilih slot kelipatan 1 jam.
// - Batas order aktif per Barber per hari (default 7, dapat diatur via env).
// - Setiap order menempati BLOK 2 JAM pada Barber (2 jam = durasi layanan maksimal),
//   sehingga order satu Barber otomatis berjarak >= 2 jam; dengan >1 Barber, toko
//   tetap dapat melayani per jam (Barber berbeda mengisi jam berbeda).
// - Auto-pick Barber idle yang membuka Open Order bila customer tidak memilih manual.
// ============================================================================
const WORK_OPEN_MINUTES = BOOKING_CONFIG.operationalStartMinutes;    // 08:00
const WORK_CLOSE_MINUTES = BOOKING_CONFIG.operationalLastBookingMinutes; // 22:00
const SLOT_INTERVAL_MINUTES = BOOKING_CONFIG.customerBookingIntervalMinutes; // kelipatan 1 jam
const BARBER_BLOCK_MINUTES = BOOKING_CONFIG.barberBlockMinutes; // blok 2 jam per order
const IDLE_BARBER_STATUSES = BOOKING_CONFIG.idleBarberStatuses;
const MAX_ORDERS_PER_BARBER_PER_DAY = BOOKING_CONFIG.maxDailyOrdersPerBarber;
// Bila true (default), customer boleh punya >1 order aktif di jam yang sama;
// kapasitasnya dibatasi jumlah barber idle+online (cek per-barber di bawah),
// bukan oleh larangan double-booking milik customer sendiri.
const ALLOW_CUSTOMER_CONCURRENT_ORDERS = BOOKING_CONFIG.allowCustomerConcurrentOrders;

const makeError = (message: string, status = 400, code?: string) => {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code) error.code = code;
  return error;
};

const normalizeAppointmentDateTime = (value: string | Date, field = 'scheduled_at') => {
  const date = value instanceof Date ? value : parseDbTime(value);
  if (Number.isNaN(date.getTime())) {
    throw makeError(`${field} tidak valid`);
  }
  return date.toISOString();
};

// Ekstrak tanggal (YYYY-MM-DD) & menit-dalam-hari pada zona project (Asia/Jakarta).
const jakartaParts = (date: Date) => configJakartaParts(date);

// Jam booking lokal ('HH:MM') dari sebuah instant ISO — untuk mapping periode Open Order.
const configBookingTime = (scheduledAtIso: string) => {
  const { minutes } = jakartaParts(new Date(scheduledAtIso));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

// [REVISI B7] Validasi jadwal online: dalam jam kerja 08:00–22:00 (inklusif) &
// pada slot kelipatan 1 jam. Customer boleh memilih 08:00 sampai 22:00.
//
// `enforceSlot` hanya diaktifkan bila customer memilih jadwal eksplisit
// (scheduled_at). Untuk order on-demand/ASAP (tanpa scheduled_at) jadwal
// di-default ke waktu sekarang yang hampir tidak pernah pas di menit :00,
// sehingga aturan slot jam-bulat tidak boleh dipaksakan — cukup validasi
// bahwa waktunya masih di dalam jam kerja (berfungsi sebagai cutoff).
const assertWithinWorkingWindow = (scheduledAtIso: string, opts: { enforceSlot?: boolean } = {}) => {
  const { enforceSlot = true } = opts;
  const date = new Date(scheduledAtIso);
  if (Number.isNaN(date.getTime())) {
    throw makeError('scheduled_at tidak valid');
  }
  const { minutes } = jakartaParts(date);
  if (minutes < WORK_OPEN_MINUTES || minutes > WORK_CLOSE_MINUTES) {
    throw makeError('Order hanya dapat dibuat pada jam kerja 08:00–22:00', 400, 'OUTSIDE_WORKING_HOURS');
  }
  if (enforceSlot && minutes % SLOT_INTERVAL_MINUTES !== 0) {
    throw makeError('Jadwal harus pada slot kelipatan 1 jam (08:00, 09:00, … 22:00)', 400, 'INVALID_SLOT');
  }
};

// Blok waktu barber untuk sebuah order: [start, start + 2 jam], minimal 2 jam
// walau durasi layanan/ongkir lebih pendek (2 jam = durasi layanan maksimal).
const barberBlockRange = (scheduledAtIso: string) => {
  const start = new Date(scheduledAtIso);
  const end = new Date(start.getTime() + BARBER_BLOCK_MINUTES * 60_000);
  return { start, end };
};

// Rentang hari (Asia/Jakarta) untuk suatu waktu, sebagai ISO instant.
const jakartaDayRange = (scheduledAtIso: string) => {
  const { date } = jakartaParts(new Date(scheduledAtIso));
  const dayStart = new Date(`${date}T00:00:00+07:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
};

// [REVISI B8] Hitung jumlah order aktif barber pada hari jadwal.
const countBarberOrdersForDay = async (
  barberId: string,
  scheduledAtIso: string,
  excludeAppointmentId?: string
) => {
  const { dayStart, dayEnd } = jakartaDayRange(scheduledAtIso);
  const conds: SQL[] = [
    eq(appointments.barberId, barberId),
    notInArray(appointments.status, ['cancelled', 'no_show']),
    gte(appointments.scheduledAt, dayStart.toISOString()),
    lt(appointments.scheduledAt, dayEnd.toISOString())
  ];
  if (excludeAppointmentId) conds.push(ne(appointments.id, excludeAppointmentId));
  const rows = await db.select({ count: sql<number>`count(*)` }).from(appointments).where(and(...conds));
  return Number(rows[0]?.count ?? 0);
};

// Cek bentrok jadwal barber pada rentang [start, end]. Setiap order lama
// dianggap menempati minimal 2 jam sejak jadwalnya (BARBER_BLOCK_MINUTES).
const barberHasConflict = async (
  barberId: string,
  start: Date,
  end: Date,
  excludeAppointmentId?: string
) => {
  const conds: SQL[] = [
    eq(appointments.barberId, barberId),
    inArray(appointments.status, ACTIVE_APPOINTMENT_STATUSES as any),
    gte(appointments.scheduledAt, new Date(start.getTime() - 24 * 3600_000).toISOString()),
    lt(appointments.scheduledAt, new Date(end.getTime() + 24 * 3600_000).toISOString())
  ];
  if (excludeAppointmentId) conds.push(ne(appointments.id, excludeAppointmentId));
  const data = snakeKeys(
    await db
      .select({
        id: appointments.id,
        scheduled_at: appointments.scheduledAt,
        scheduled_end_at: appointments.scheduledEndAt,
        schedule_block_start_at: appointments.scheduleBlockStartAt,
        schedule_block_end_at: appointments.scheduleBlockEndAt
      })
      .from(appointments)
      .where(and(...conds))
  ) as any[];

  return data.some((apt: any) => {
    const blockStart = new Date(apt.schedule_block_start_at || apt.scheduled_at);
    const storedEnd = apt.schedule_block_end_at || apt.scheduled_end_at;
    // Blok efektif barber minimal 2 jam sejak mulai.
    const minBlockEnd = new Date(blockStart.getTime() + BARBER_BLOCK_MINUTES * 60_000);
    const blockEnd = storedEnd && new Date(storedEnd) > minBlockEnd
      ? new Date(storedEnd)
      : minBlockEnd;
    return blockStart < end && blockEnd > start;
  });
};

// [SPEC BOOKING] Cek apakah customer sudah punya booking aktif yang bentrok
// dengan blok 2 jam waktu yang diminta. Mencegah double-booking di jam sama.
const customerHasConflict = async (
  customerId: string,
  start: Date,
  end: Date,
  excludeAppointmentId?: string
) => {
  const conds: SQL[] = [
    eq(appointments.customerId, customerId),
    inArray(appointments.status, ACTIVE_APPOINTMENT_STATUSES as any),
    gte(appointments.scheduledAt, new Date(start.getTime() - 24 * 3600_000).toISOString()),
    lt(appointments.scheduledAt, new Date(end.getTime() + 24 * 3600_000).toISOString())
  ];
  if (excludeAppointmentId) conds.push(ne(appointments.id, excludeAppointmentId));
  const data = snakeKeys(
    await db
      .select({
        id: appointments.id,
        scheduled_at: appointments.scheduledAt,
        schedule_block_start_at: appointments.scheduleBlockStartAt,
        schedule_block_end_at: appointments.scheduleBlockEndAt,
        scheduled_end_at: appointments.scheduledEndAt
      })
      .from(appointments)
      .where(and(...conds))
  ) as any[];

  return data.some((apt: any) => {
    const blockStart = new Date(apt.schedule_block_start_at || apt.scheduled_at);
    const storedEnd = apt.schedule_block_end_at || apt.scheduled_end_at;
    const minBlockEnd = new Date(blockStart.getTime() + BARBER_BLOCK_MINUTES * 60_000);
    const blockEnd = storedEnd && new Date(storedEnd) > minBlockEnd
      ? new Date(storedEnd)
      : minBlockEnd;
    return blockStart < end && blockEnd > start;
  });
};

// [AUTO-REPLACE] Batalkan order online BELUM DIBAYAR milik customer yang masih
// 'pending' agar tidak memblokir booking baru (konflik slot customer, blok &
// kuota barber). Order yang SUDAH dibayar (menunggu barber accept) maupun yang
// sudah diterima/berjalan (confirmed/in_queue/in_service) TIDAK disentuh.
// [REVISI] Order belum-dibayar yang JADWALNYA BELUM LEWAT juga TIDAK disentuh:
// customer boleh punya beberapa order terjadwal ke depan (dibayar/diedit belakangan);
// hanya order lampau (scheduled_at <= now) atau tanpa jadwal yang direplace.
// Mengembalikan daftar id yang dibatalkan agar UI bisa memberi tahu customer.
const cancelReplaceableUnpaidOrders = async (customerId: string): Promise<string[]> => {
  const data = await db
    .select({
      id: appointments.id,
      source: appointments.source,
      scheduledAt: appointments.scheduledAt,
      payStatus: payments.status
    })
    .from(appointments)
    .leftJoin(payments, eq(payments.appointmentId, appointments.id))
    .where(and(eq(appointments.customerId, customerId), eq(appointments.status, 'pending')));
  if (!data.length) return [];

  const now = Date.now();
  const cancelled: string[] = [];
  for (const apt of data as any[]) {
    if (apt.source !== 'online_booking') continue;
    const isPaid = apt.payStatus === 'paid';
    if (isPaid) continue;
    // Pertahankan order yang jadwalnya masih di masa depan (belum lewat).
    const scheduledAt = apt.scheduledAt ? new Date(apt.scheduledAt) : null;
    if (scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > now) {
      continue;
    }
    try {
      await AppointmentLifecycleService.transition(apt.id, 'cancelled', {
        actor: { type: 'system', id: null, role: 'system' },
        reason: 'Dibatalkan otomatis: customer membuat booking baru & order ini belum dibayar'
      });
      cancelled.push(apt.id);
    } catch (err: any) {
      // Non-fatal: kegagalan membatalkan satu order tidak boleh memblokir booking baru.
      logger.error({ err, appointmentId: apt.id }, '[AutoReplace] Gagal membatalkan order');
    }
  }
  return cancelled;
};

// [SELF-HEAL] Batalkan order online 'pending' BELUM DIBAYAR yang sudah melewati
// batas waktu penerimaan (created_at + ORDER_ACCEPTANCE_TIMEOUT_MINUTES). Ini
// adalah fallback bila BullMQ worker (`order_acceptance_timeout`) tidak berjalan
// — mis. Redis mati — agar slot & kuota barber tidak tertahan order abandoned.
// Dipanggil secara lazy saat fetch slot & sebelum booking dibuat, di-scope ke
// cabang bila `branchId` diberikan agar murah. Order yang sudah dibayar TIDAK
// disentuh (biarkan lifecycle/refund menanganinya).
export const sweepExpiredUnpaidPendingOrders = async (
  opts: { branchId?: string; customerId?: string } = {}
): Promise<string[]> => {
  // Order online 'pending' yang belum dibayar dibatalkan otomatis setelah 2 jam.
  const deadlineCutoff = new Date(
    Date.now() - UNPAID_ORDER_EXPIRY_MINUTES * 60_000
  ).toISOString();

  const conds: SQL[] = [
    eq(appointments.source, 'online_booking'),
    eq(appointments.status, 'pending'),
    lt(appointments.createdAt, deadlineCutoff)
  ];
  if (opts.branchId) conds.push(eq(appointments.branchId, opts.branchId));
  if (opts.customerId) conds.push(eq(appointments.customerId, opts.customerId));

  const data = await db
    .select({ id: appointments.id, payStatus: payments.status })
    .from(appointments)
    .leftJoin(payments, eq(payments.appointmentId, appointments.id))
    .where(and(...conds));
  if (!data.length) return [];

  const cancelled: string[] = [];
  for (const apt of data as any[]) {
    const isPaid = apt.payStatus === 'paid';
    if (isPaid) continue;
    try {
      await AppointmentLifecycleService.transition(apt.id, 'cancelled', {
        actor: { type: 'system', id: null, role: 'system' },
        reason: 'Dibatalkan otomatis: melewati batas waktu penerimaan & belum dibayar'
      });
      cancelled.push(apt.id);
    } catch (err: any) {
      // Non-fatal: jangan sampai kegagalan sweep menghambat fetch slot/booking.
      logger.error({ err, appointmentId: apt.id }, '[Sweep] Gagal membatalkan order kedaluwarsa');
    }
  }
  return cancelled;
};

// Pesan baku bila tidak ada barber tersedia (dipakai auto-pick & manual).
const NO_BARBER_MESSAGE =
  'Mohon maaf, tidak ada barber tersedia pada jam tersebut. Silakan pilih jam lain.';

// Waktu order terakhir barber diselesaikan (untuk metrik "paling lama idle").
// null bila belum pernah menyelesaikan order → dianggap paling idle.
const lastCompletedAt = async (barberId: string): Promise<number | null> => {
  const [data] = await db
    .select({ updated_at: appointments.updatedAt, scheduled_at: appointments.scheduledAt })
    .from(appointments)
    .where(and(eq(appointments.barberId, barberId), eq(appointments.status, 'completed')))
    .orderBy(desc(appointments.updatedAt))
    .limit(1);
  if (!data) return null;
  const ts = new Date(data.updated_at || data.scheduled_at!).getTime();
  return Number.isFinite(ts) ? ts : null;
};

// [REVISI A4 / SPEC BOOKING] Pilih Barber idle di cabang, hormati kuota &
// blok 2 jam. Prioritas: (1) order hari ini tersedikit → (2) paling lama sejak
// order terakhir selesai → (3) acak.
const pickBestAvailableBarber = async (
  branchId: string,
  scheduledAtIso: string,
  eligibleBarberIds?: string[]
): Promise<string> => {
  const barberRows = await db
    .select({ id: barbers.id, live_status: barbers.liveStatus, approval_status: barbers.approvalStatus })
    .from(barbers)
    .where(
      and(
        eq(barbers.branchId, branchId),
        // [REVISI C1] Auto-pick hanya barber yang sudah dikonfirmasi admin.
        eq(barbers.approvalStatus, 'approved'),
        isNull(barbers.deletedAt)
      )
    );

  const idleBarbers = barberRows.filter((b: any) =>
    b.approval_status === 'approved' &&
    IDLE_BARBER_STATUSES.includes(String(b.live_status ?? '')) &&
    (!eligibleBarberIds || eligibleBarberIds.includes(b.id))
  );
  if (idleBarbers.length === 0) {
    throw makeError(NO_BARBER_MESSAGE, 409, 'NO_BARBER_AVAILABLE');
  }

  const { start, end } = barberBlockRange(scheduledAtIso);

  // [SPEC BOOKING §11] Barber hanya dipertimbangkan bila membuka Open Order pada
  // periode yang mencakup jam booking. Muat konteks sekali untuk seluruh kandidat.
  const openOrderContext = await OpenOrderService.loadContextForIso(branchId, scheduledAtIso);
  const bookingTime = configBookingTime(scheduledAtIso);

  // Kumpulkan kandidat yang lolos Open Order, kuota & bentrok, beserta metrik prioritas.
  const candidates: { id: string; orders: number; lastDone: number | null }[] = [];
  for (const barber of idleBarbers) {
    if (!OpenOrderService.isBarberOpen(openOrderContext, barber.id, bookingTime)) continue;
    const orders = await countBarberOrdersForDay(barber.id, scheduledAtIso);
    if (orders >= MAX_ORDERS_PER_BARBER_PER_DAY) continue;
    if (await barberHasConflict(barber.id, start, end)) continue;
    candidates.push({ id: barber.id, orders, lastDone: await lastCompletedAt(barber.id) });
  }

  if (candidates.length === 0) {
    throw makeError(NO_BARBER_MESSAGE, 409, 'NO_BARBER_AVAILABLE');
  }

  // (1) order tersedikit → (2) lastDone paling lama (null = paling idle, didahulukan).
  candidates.sort((a, b) => {
    if (a.orders !== b.orders) return a.orders - b.orders;
    const la = a.lastDone ?? -Infinity; // belum pernah menyelesaikan → paling idle
    const lb = b.lastDone ?? -Infinity;
    return la - lb; // timestamp lebih kecil (lebih lama) didahulukan
  });

  // (3) acak di antara yang seri pada prioritas teratas.
  const top = candidates[0];
  const tied = candidates.filter((c) => c.orders === top.orders && (c.lastDone ?? -Infinity) === (top.lastDone ?? -Infinity));
  return tied[Math.floor(Math.random() * tied.length)].id;
};

// Total durasi layanan (menit) untuk sekumpulan service_ids.
const sumServiceDurations = async (serviceIds: string[]) => {
  const data = await db
    .select({ default_duration_min: services.defaultDurationMin })
    .from(services)
    .where(inArray(services.id, Array.from(new Set(serviceIds))));
  const total = data.reduce((sum: number, s: any) => sum + Number(s.default_duration_min || 0), 0);
  return total > 0 ? total : 30;
};

// Hidrasi relasi embedded untuk daftar/detail appointment customer (pengganti
// nested select relasi: appointment_services→services, branches, barbers,
// payments, reviews). Menerima baris appointment (snake_case) + kembalikan
// baris yang sudah dilengkapi relasi bersarang.
async function hydrateCustomerAppointments(baseRows: any[]): Promise<any[]> {
  if (!baseRows.length) return [];
  const ids = baseRows.map((r) => r.id);
  const branchIds = [...new Set(baseRows.map((r) => r.branch_id).filter(Boolean))] as string[];
  const barberIds = [...new Set(baseRows.map((r) => r.barber_id).filter(Boolean))] as string[];

  const [svcRows, branchRows, barberRows, payRows, reviewRows] = await Promise.all([
    db
      .select({
        appointmentId: appointmentServices.appointmentId,
        id: appointmentServices.id,
        service_id: appointmentServices.serviceId,
        price_amount: appointmentServices.priceAmount,
        duration_min: appointmentServices.durationMin,
        sId: services.id,
        sName: services.name,
        sDesc: services.description,
        sImg: services.imageUrl
      })
      .from(appointmentServices)
      .leftJoin(services, eq(appointmentServices.serviceId, services.id))
      .where(inArray(appointmentServices.appointmentId, ids)),
    branchIds.length
      ? db.select({ id: branches.id, name: branches.name, address: branches.address, latitude: branches.latitude, longitude: branches.longitude }).from(branches).where(inArray(branches.id, branchIds))
      : Promise.resolve([] as any[]),
    barberIds.length
      ? db.select({ id: barbers.id, display_name: barbers.displayName, rating_avg: barbers.ratingAvg, rating_count: barbers.ratingCount }).from(barbers).where(inArray(barbers.id, barberIds))
      : Promise.resolve([] as any[]),
    db
      .select({
        appointmentId: payments.appointmentId,
        status: payments.status,
        total_amount: payments.totalAmount,
        service_amount: payments.serviceAmount,
        product_amount: payments.productAmount,
        tip_amount: payments.tipAmount,
        service_fee: payments.serviceFee,
        delivery_fee: payments.deliveryFee,
        discount_amount: payments.discountAmount,
        method: payments.method
      })
      .from(payments)
      .where(inArray(payments.appointmentId, ids)),
    db
      .select({ appointmentId: reviews.appointmentId, rating: reviews.rating, comment: reviews.comment })
      .from(reviews)
      .where(inArray(reviews.appointmentId, ids))
  ]);

  const svcByAppt: Record<string, any[]> = {};
  for (const s of svcRows) {
    (svcByAppt[s.appointmentId] ??= []).push({
      id: s.id,
      service_id: s.service_id,
      price_amount: s.price_amount,
      duration_min: s.duration_min,
      services: s.sId ? { id: s.sId, name: s.sName, description: s.sDesc, image_url: s.sImg } : null
    });
  }
  const branchMap: Record<string, any> = {};
  for (const b of branchRows) branchMap[b.id] = b;
  const barberMap: Record<string, any> = {};
  for (const b of barberRows) barberMap[b.id] = b;
  const payByAppt: Record<string, any[]> = {};
  for (const p of payRows) {
    const { appointmentId, ...rest } = p;
    (payByAppt[appointmentId] ??= []).push(rest);
  }
  const revByAppt: Record<string, any[]> = {};
  for (const r of reviewRows) {
    (revByAppt[r.appointmentId] ??= []).push({ rating: r.rating, comment: r.comment });
  }

  return baseRows.map((r) => ({
    ...r,
    appointment_services: svcByAppt[r.id] ?? [],
    branches: r.branch_id ? branchMap[r.branch_id] ?? null : null,
    barbers: r.barber_id ? barberMap[r.barber_id] ?? null : null,
    payments: payByAppt[r.id] ?? [],
    reviews: revByAppt[r.id] ?? []
  }));
}

// Hidrasi relasi untuk order barber (queue & history): customers{full_name},
// branches{name,address}, appointment_services[{price_amount, services{name}}],
// dan opsional payments.
async function hydrateBarberOrders(
  baseRows: any[],
  opts: { withPayments?: boolean; withLocation?: boolean } = {}
): Promise<any[]> {
  if (!baseRows.length) return [];
  const ids = baseRows.map((r) => r.id);
  const custIds = [...new Set(baseRows.map((r) => r.customer_id).filter(Boolean))] as string[];
  const branchIds = [...new Set(baseRows.map((r) => r.branch_id).filter(Boolean))] as string[];

  const [svcRows, custRows, branchRows, payRows] = await Promise.all([
    db
      .select({ appointmentId: appointmentServices.appointmentId, price_amount: appointmentServices.priceAmount, serviceName: services.name })
      .from(appointmentServices)
      .leftJoin(services, eq(appointmentServices.serviceId, services.id))
      .where(inArray(appointmentServices.appointmentId, ids)),
    custIds.length
      ? db.select({ id: customers.id, full_name: customers.fullName }).from(customers).where(inArray(customers.id, custIds))
      : Promise.resolve([] as any[]),
    branchIds.length
      ? db.select({ id: branches.id, name: branches.name, address: branches.address }).from(branches).where(inArray(branches.id, branchIds))
      : Promise.resolve([] as any[]),
    opts.withPayments
      ? db
          .select({ appointmentId: payments.appointmentId, id: payments.id, status: payments.status, method: payments.method, gateway_reference: payments.gatewayReference })
          .from(payments)
          .where(inArray(payments.appointmentId, ids))
      : Promise.resolve([] as any[])
  ]);

  const svcByAppt: Record<string, any[]> = {};
  for (const s of svcRows) (svcByAppt[s.appointmentId] ??= []).push({ price_amount: s.price_amount, services: { name: s.serviceName } });
  const custMap: Record<string, any> = {};
  for (const c of custRows) custMap[c.id] = { full_name: c.full_name };
  const branchMap: Record<string, any> = {};
  for (const b of branchRows) branchMap[b.id] = { name: b.name, address: b.address };
  const payByAppt: Record<string, any[]> = {};
  for (const p of payRows) {
    const { appointmentId, ...rest } = p;
    (payByAppt[appointmentId] ??= []).push(rest);
  }

  return baseRows.map((r) => ({
    ...r,
    customers: r.customer_id ? custMap[r.customer_id] ?? null : null,
    branches: r.branch_id ? branchMap[r.branch_id] ?? null : null,
    appointment_services: svcByAppt[r.id] ?? [],
    ...(opts.withPayments ? { payments: payByAppt[r.id] ?? [] } : {})
  }));
}

export class AppointmentService {
  /**
   * [REVISI B8] Pastikan barber belum melampaui kuota harian saat menerima order.
   * Order yang sedang diterima dikecualikan dari hitungan (agar order ke-7 tetap
   * boleh diterima). Melempar error BARBER_QUOTA_FULL bila sudah penuh.
   */
  static async assertBarberDailyQuota(
    barberId: string,
    scheduledAtIso: string,
    excludeAppointmentId?: string
  ) {
    const others = await countBarberOrdersForDay(barberId, scheduledAtIso, excludeAppointmentId);
    if (others >= MAX_ORDERS_PER_BARBER_PER_DAY) {
      throw makeError(
        `Kuota harian penuh (maks ${MAX_ORDERS_PER_BARBER_PER_DAY} order/hari).`,
        409,
        'BARBER_QUOTA_FULL'
      );
    }
  }

  /**
   * Membuat appointment dan snapshot layanan melalui satu transaksi database.
   */
  static async createAppointment(
    payload: CreatePayload,
    source: 'online_booking' | 'walk_in',
    actor: AppointmentActor
  ) {
    if (!payload.service_ids || payload.service_ids.length === 0) {
      throw new Error('Minimal harus memilih 1 layanan (service)');
    }
    if (!payload.idempotency_key?.trim()) {
      throw new Error('Header Idempotency-Key wajib disertakan');
    }

    const fulfillmentType = payload.fulfillment_type || 'in_store';
    if (!['in_store', 'home_service'].includes(fulfillmentType)) {
      throw new Error('fulfillment_type harus in_store atau home_service');
    }

    const explicitScheduledAt = payload.scheduled_at
      ? normalizeAppointmentDateTime(payload.scheduled_at)
      : undefined;

    let homeServiceLocation: { lat: number; lng: number } | null = null;
    if (fulfillmentType === 'home_service') {
      // [REVISI A4] barber_id TIDAK lagi wajib — bila kosong, sistem auto-pick
      // Barber idle (lihat pickRandomAvailableBarber di bawah).
      if (!payload.service_address?.trim()) {
        throw new Error('service_address wajib diisi untuk home_service');
      }

      if (
        payload.destination_latitude == null || payload.destination_latitude === 0 ||
        payload.destination_longitude == null || payload.destination_longitude === 0
      ) {
        throw new Error('Titik potong/lokasi harus diisi');
      }

      homeServiceLocation = normalizeLocation(
        payload.destination_latitude,
        payload.destination_longitude,
        'destination_latitude',
        'destination_longitude'
      );
    }

    const [existing] = snakeKeys(
      await db
        .select()
        .from(appointments)
        .where(eq(appointments.idempotencyKey, payload.idempotency_key.trim()))
        .limit(1)
    ) as any[];

    if (existing) {
      const existingScheduledAt = existing.scheduled_at
        ? normalizeAppointmentDateTime(existing.scheduled_at)
        : null;
      const existingSvc = await db
        .select({ service_id: appointmentServices.serviceId })
        .from(appointmentServices)
        .where(eq(appointmentServices.appointmentId, existing.id));
      const requestedServices = [...payload.service_ids].sort();
      const existingServices = existingSvc
        .map((item: any) => item.service_id)
        .sort();
      const sameRequest =
        existing.branch_id === payload.branch_id
        // [REVISI A4] Bila barber_id tidak dikirim (auto-pick), jangan bandingkan —
        // retry idempotent yang sah tak boleh ditolak hanya karena barber ter-auto-assign.
        && (!payload.barber_id || existing.barber_id === payload.barber_id)
        && existing.customer_id === (payload.customer_id || null)
        && existing.source === source
        && existing.fulfillment_type === fulfillmentType
        && (!explicitScheduledAt || existingScheduledAt === explicitScheduledAt)
        && (
          fulfillmentType !== 'home_service'
          || (
            existing.service_address === payload.service_address?.trim()
            && Number(existing.destination_latitude) === Number(payload.destination_latitude)
            && Number(existing.destination_longitude) === Number(payload.destination_longitude)
          )
        )
        && JSON.stringify(existingServices) === JSON.stringify(requestedServices);

      if (!sameRequest) {
        const error = new Error(
          'Idempotency-Key sudah digunakan untuk request berbeda'
        ) as Error & { status?: number; code?: string };
        error.status = 409;
        error.code = 'IDEMPOTENCY_KEY_REUSED';
        throw error;
      }

      await scheduleAppointmentTimeouts(existing);
      return existing;
    }

    // On-demand/ASAP bila customer tidak memilih jadwal eksplisit — default ke
    // waktu sekarang (+5 menit untuk booking online). Slot jam-bulat tidak
    // dipaksakan untuk kasus ini (lihat assertWithinWorkingWindow).
    const isOnDemand = !explicitScheduledAt;
    const scheduledAt = explicitScheduledAt || new Date(
      Date.now() + (source === 'online_booking' ? 5 * 60_000 : 0)
    ).toISOString();
    const travelBufferMin = fulfillmentType === 'home_service'
      ? Number(process.env.HOME_SERVICE_TRAVEL_BUFFER_MINUTES || 15)
      : 0;
    let eligibleBarberIds: string[] | undefined;

    if (
      source !== 'online_booking' &&
      fulfillmentType === 'home_service' &&
      homeServiceLocation
    ) {
      await BranchServiceAreaService.assertBranchCanServeLocation(
        payload.branch_id,
        homeServiceLocation,
        {
          barberId: payload.barber_id ?? null,
          customerId: payload.customer_id ?? null,
          source: 'booking_submit'
        }
      );
    }

    // [REVISI B7/B8/A4 + SPEC BOOKING] Aturan operasional hanya untuk booking online.
    // Walk-in (dibuat admin di lokasi) tidak dibatasi jam/slot/kuota.
    let resolvedBarberId = payload.barber_id || null;
    let replacedAppointmentIds: string[] = [];
    if (source === 'online_booking') {
      if (fulfillmentType === 'home_service' && homeServiceLocation) {
        const serviceArea = await BranchServiceAreaService.assertBranchCanServeLocation(
          payload.branch_id,
          homeServiceLocation,
          {
            barberId: resolvedBarberId,
            customerId: payload.customer_id ?? null,
            source: 'booking_submit'
          }
        );
        eligibleBarberIds = serviceArea.eligibleBarbers.map((barber) => barber.id);
      }

      // Jam kerja 08:00–22:00 + slot kelipatan 1 jam. Juga berfungsi sebagai
      // cutoff: order on-demand yang dibuat di luar jam kerja akan ditolak.
      // Slot jam-bulat hanya divalidasi bila customer menjadwalkan eksplisit.
      assertWithinWorkingWindow(scheduledAt, { enforceSlot: !isOnDemand });

      // [SELF-HEAL] Bersihkan order kedaluwarsa & belum dibayar di cabang ini
      // (fallback bila worker mati) agar slot/kuota barber yang sudah "hangus"
      // tidak ikut memblokir booking baru. Non-fatal: jangan sampai menghambat booking.
      try {
        await sweepExpiredUnpaidPendingOrders({ branchId: payload.branch_id });
      } catch (err: any) {
        logger.error({ err, branchId: payload.branch_id }, '[Sweep] Gagal membersihkan order kedaluwarsa saat booking');
      }

      // [AUTO-REPLACE] Bebaskan order lama customer yang BELUM DIBAYAR sebelum
      // cek konflik/kuota. Karena semua cek di bawah mengabaikan status
      // 'cancelled', membatalkan di sini otomatis melepas konflik slot customer,
      // blok & kuota barber — sehingga booking baru tidak terblokir oleh order
      // customer sendiri yang belum dibayar. Dilakukan setelah validasi jam kerja
      // agar order lama tidak terlanjur dibatalkan bila jam yang diminta invalid.
      if (payload.customer_id) {
        replacedAppointmentIds = await cancelReplaceableUnpaidOrders(payload.customer_id);
      }

      const { start: blockStart, end: blockEnd } = barberBlockRange(scheduledAt);

      // Customer boleh punya >1 order aktif di jam yang sama SELAMA masih ada
      // barber idle+online (dibatasi cek per-barber/pickBestAvailableBarber di
      // bawah). Larangan double-booking hanya diberlakukan bila fitur multi-order
      // dimatikan (ALLOW_CUSTOMER_CONCURRENT_ORDERS=false).
      if (!ALLOW_CUSTOMER_CONCURRENT_ORDERS
        && payload.customer_id
        && await customerHasConflict(payload.customer_id, blockStart, blockEnd)) {
        throw makeError(
          'Anda sudah memiliki booking aktif pada jam tersebut. Silakan pilih jam lain.',
          409,
          'CUSTOMER_DOUBLE_BOOKING'
        );
      }

      if (resolvedBarberId) {
        // Manual: Barber harus membuka Open Order pada periode ini, belum penuh,
        // & tidak bentrok pada blok 2 jam.
        if (!(await OpenOrderService.isBarberOpenForIso(resolvedBarberId, payload.branch_id, scheduledAt))) {
          throw makeError('Barber tidak tersedia pada jam tersebut.', 409, 'BARBER_NOT_OPEN');
        }
        const count = await countBarberOrdersForDay(resolvedBarberId, scheduledAt);
        if (count >= MAX_ORDERS_PER_BARBER_PER_DAY) {
          throw makeError(
            'Barber sudah mencapai batas maksimal order harian.',
            409,
            'BARBER_QUOTA_FULL'
          );
        }
        if (await barberHasConflict(resolvedBarberId, blockStart, blockEnd)) {
          throw makeError('Barber tidak tersedia pada jam tersebut.', 409, 'NO_BARBER_AVAILABLE');
        }
      } else {
        // Auto: pilih Barber idle terbaik (tersedikit order → paling idle → acak).
        resolvedBarberId = await pickBestAvailableBarber(
          payload.branch_id,
          scheduledAt,
          eligibleBarberIds
        );
      }
    }

    const { data: appointment, error: aptError } = await asRpcResult(() =>
      createAppointmentAtomic({
        branchId: payload.branch_id,
        barberId: resolvedBarberId,
        customerId: payload.customer_id || null,
        serviceIds: Array.from(new Set(payload.service_ids)),
        scheduledAt,
        source,
        idempotencyKey: payload.idempotency_key.trim(),
        actorType: actor.type,
        actorId: actor.id as string,
        customerMediaUrls: payload.media_urls || [],
        fulfillmentType,
        serviceAddress: payload.service_address?.trim() || null,
        destinationLatitude: payload.destination_latitude ?? null,
        destinationLongitude: payload.destination_longitude ?? null,
        locationNotes: payload.location_notes?.trim() || null,
        travelBufferMin: Number.isFinite(travelBufferMin) ? travelBufferMin : 15
      })
    );

    if (aptError || !appointment) {
      const error = new Error(
        aptError?.message || 'Gagal membuat appointment'
      ) as Error & { status?: number; code?: string };
      error.code = aptError?.code;
      error.status = ['23P01', '23505', 'P0001'].includes(aptError?.code ?? '')
        ? 409
        : aptError?.code === 'P0002'
          ? 404
          : aptError?.code === '42501'
            ? 403
            : 400;
      throw error;
    }

    await scheduleAppointmentTimeouts(appointment);
    // [REVISI C3] Jadwalkan pengingat (maks 3 minggu ke depan) untuk online booking.
    await scheduleAppointmentReminder(appointment);

    // [SOCKET.IO] Notifikasi barber yang ditugaskan tentang order baru
    const newOrderEvent = {
      appointment_id: appointment.id,
      timestamp: new Date().toISOString()
    };
    if (appointment.barber_id) {
      emitNewOrder(appointment.barber_id, newOrderEvent);
    }
    // Selalu broadcast ke branch room agar admin/manager juga menerima notifikasi
    io.to(`branch:${appointment.branch_id}`).emit('appointment:new_order', newOrderEvent);

    // Sertakan id order lama yang di-auto-replace agar UI dapat memberi tahu customer.
    return { ...appointment, replaced_appointment_ids: replacedAppointmentIds };
  }

  /**
   * [REVISI A8] Ubah order SEBELUM dibayar. Hanya boleh saat status masih
   * `pending` dan belum ada pembayaran `paid`. Field yang dapat diubah (sesuai
   * keputusan klien): TANGGAL/JAM, LOKASI tujuan, dan CATATAN. Barber dan
   * daftar layanan TIDAK dapat diubah di sini (untuk mengganti: batalkan & pesan
   * ulang) agar penugasan & harga snapshot tetap konsisten.
   */
  static async updateBeforePayment(
    customerId: string,
    appointmentId: string,
    payload: {
      scheduled_at?: string;
      service_address?: string;
      destination_latitude?: number;
      destination_longitude?: number;
      location_notes?: string;
    }
  ) {
    const [apt] = snakeKeys(
      await db
        .select({
          id: appointments.id,
          customer_id: appointments.customerId,
          status: appointments.status,
          branch_id: appointments.branchId,
          barber_id: appointments.barberId,
          fulfillment_type: appointments.fulfillmentType,
          scheduled_at: appointments.scheduledAt,
          travel_buffer_min: appointments.travelBufferMin,
          destination_latitude: appointments.destinationLatitude,
          destination_longitude: appointments.destinationLongitude
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1)
    ) as any[];

    if (!apt || apt.customer_id !== customerId) {
      throw makeError('Pemesanan tidak ditemukan', 404);
    }
    if (apt.status !== 'pending') {
      throw makeError('Order hanya dapat diubah selagi masih menunggu konfirmasi (pending)', 400, 'ORDER_NOT_EDITABLE');
    }
    const paidRows = await db
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.appointmentId, appointmentId));
    if (paidRows.some((p) => p.status === 'paid')) {
      throw makeError('Order sudah dibayar, tidak dapat diubah lagi', 400, 'ALREADY_PAID');
    }
    apt.appointment_services = await db
      .select({ duration_min: appointmentServices.durationMin })
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, appointmentId));

    if (apt.fulfillment_type === 'home_service') {
      const destination = normalizeLocation(
        payload.destination_latitude ?? apt.destination_latitude,
        payload.destination_longitude ?? apt.destination_longitude,
        'destination_latitude',
        'destination_longitude'
      );
      await BranchServiceAreaService.assertBranchCanServeLocation(
        apt.branch_id,
        destination,
        {
          barberId: apt.barber_id,
          customerId,
          source: 'booking_update_before_payment'
        }
      );
    }

    const durationMin = (apt.appointment_services ?? [])
      .reduce((sum: number, item: any) => sum + Number(item.duration_min || 0), 0) || 30;

    const requestedScheduledAt = payload.scheduled_at
      ? normalizeAppointmentDateTime(payload.scheduled_at)
      : undefined;
    const existingScheduledAt = apt.scheduled_at
      ? normalizeAppointmentDateTime(apt.scheduled_at)
      : null;
    const newScheduledAt = requestedScheduledAt || existingScheduledAt;
    if (!newScheduledAt) {
      throw makeError('Jadwal appointment tidak tersedia', 400, 'SCHEDULE_NOT_AVAILABLE');
    }

    if (requestedScheduledAt) {
      assertWithinWorkingWindow(requestedScheduledAt);

      // Re-validasi bentrok pada blok 2 jam (kecualikan order ini sendiri).
      const { start: blockStart, end: blockEnd } = barberBlockRange(requestedScheduledAt);
      // Konsisten dengan create: larangan double-booking customer hanya berlaku
      // bila fitur multi-order dimatikan. Kapasitas tetap dijaga cek per-barber.
      if (!ALLOW_CUSTOMER_CONCURRENT_ORDERS
        && await customerHasConflict(customerId, blockStart, blockEnd, appointmentId)) {
        throw makeError(
          'Anda sudah memiliki booking aktif pada jam tersebut. Silakan pilih jam lain.',
          409,
          'CUSTOMER_DOUBLE_BOOKING'
        );
      }
      if (apt.barber_id
        && await barberHasConflict(apt.barber_id, blockStart, blockEnd, appointmentId)) {
        throw makeError(NO_BARBER_MESSAGE, 409, 'NO_BARBER_AVAILABLE');
      }
    }

    const start = new Date(newScheduledAt);
    const end = new Date(start.getTime() + durationMin * 60_000);
    const buffer = Number(apt.travel_buffer_min || 0);

    const updates: Record<string, any> = {
      scheduledAt: toDbDate(newScheduledAt),
      scheduledEndAt: toDbDate(end),
      scheduleBlockStartAt: toDbDate(new Date(start.getTime() - buffer * 60_000)),
      scheduleBlockEndAt: toDbDate(new Date(end.getTime() + buffer * 60_000))
    };
    if (payload.service_address !== undefined) {
      updates.serviceAddress = payload.service_address?.trim() || null;
    }
    if (payload.destination_latitude !== undefined) {
      updates.destinationLatitude = payload.destination_latitude != null ? String(payload.destination_latitude) : null;
    }
    if (payload.destination_longitude !== undefined) {
      updates.destinationLongitude = payload.destination_longitude != null ? String(payload.destination_longitude) : null;
    }
    if (payload.location_notes !== undefined) {
      updates.locationNotes = payload.location_notes?.trim() || null;
    }

    const res: any = await db
      .update(appointments)
      .set(updates)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.status, 'pending')));
    const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    if (!affected) {
      throw makeError('Gagal memperbarui order: tidak ada baris ter-update', 400);
    }
    const [updated] = snakeKeys(await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1));

    // Beri tahu Barber (penugasan tidak berubah) bila jadwal/lokasi diperbarui.
    if (apt.barber_id) {
      emitNewOrder(apt.barber_id, { appointment_id: appointmentId, timestamp: new Date().toISOString() });
    }

    return updated;
  }

  static async getCustomerAppointments(customerId: string, query: CustomerAppointmentsQuery = {}) {
    // [SELF-HEAL] Batalkan dulu order milik customer ini yang belum dibayar &
    // sudah lewat 2 jam, agar tidak ikut tampil di daftar "Pesanan" (fallback
    // bila BullMQ worker tidak berjalan). Non-fatal.
    try {
      await sweepExpiredUnpaidPendingOrders({ customerId });
    } catch (err: any) {
      logger.error({ err }, '[Sweep] Gagal membersihkan order kedaluwarsa customer');
    }

    const limit = normalizeLimit(query.limit);
    const page = normalizePage(query.page);
    const before = normalizeBefore(query.before);
    const statusFilter = normalizeBoolean(query.ongoing_only)
      ? ACTIVE_APPOINTMENT_STATUSES
      : normalizeStatusFilter(query.status);
    const offset = (page - 1) * limit;

    const conds: SQL[] = [eq(appointments.customerId, customerId)];
    if (statusFilter.length > 0) conds.push(inArray(appointments.status, statusFilter as any));
    if (before) conds.push(lt(appointments.createdAt, before));

    const baseRows = snakeKeys(
      await db
        .select()
        .from(appointments)
        .where(and(...conds))
        // nullsFirst:false → scheduled_at NULL di akhir.
        .orderBy(sql`${appointments.scheduledAt} IS NULL`, desc(appointments.scheduledAt), desc(appointments.createdAt))
        .limit(limit)
        .offset(offset)
    ) as any[];

    const hydrated = await hydrateCustomerAppointments(baseRows);
    return hydrated.map(formatCustomerAppointment);
  }

  static async getCustomerAppointmentDetail(customerId: string, appointmentId: string) {
    const baseRows = snakeKeys(
      await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.customerId, customerId)))
        .limit(1)
    ) as any[];

    if (!baseRows.length) {
      throw new Error('Pemesanan tidak ditemukan');
    }

    const [hydrated] = await hydrateCustomerAppointments(baseRows);
    return formatCustomerAppointment(hydrated);
  }

  static async getBarberDashboardQueue(staffId: string) {
    const [barber] = await db
      .select({ id: barbers.id })
      .from(barbers)
      .where(and(eq(barbers.staffUserId, staffId), isNull(barbers.deletedAt)))
      .limit(1);

    if (!barber) {
      throw new Error('Profil barber tidak ditemukan');
    }

    const baseRows = snakeKeys(
      await db
        .select({
          id: appointments.id,
          branch_id: appointments.branchId,
          customer_id: appointments.customerId,
          status: appointments.status,
          scheduled_at: appointments.scheduledAt,
          queue_position: appointments.queuePosition,
          created_at: appointments.createdAt,
          source: appointments.source,
          fulfillment_type: appointments.fulfillmentType,
          service_address: appointments.serviceAddress,
          destination_latitude: appointments.destinationLatitude,
          destination_longitude: appointments.destinationLongitude,
          location_notes: appointments.locationNotes,
          customer_media_urls: appointments.customerMediaUrls,
          journey_status: appointments.journeyStatus
        })
        .from(appointments)
        .where(and(eq(appointments.barberId, barber.id), inArray(appointments.status, BARBER_QUEUE_STATUSES as any)))
        .orderBy(
          sql`${appointments.queuePosition} IS NULL`,
          asc(appointments.queuePosition),
          sql`${appointments.scheduledAt} IS NULL`,
          asc(appointments.scheduledAt),
          asc(appointments.createdAt)
        )
    ) as any[];

    const data = await hydrateBarberOrders(baseRows, { withPayments: true, withLocation: true });

    // [REVISI B6] Barber tidak lagi perlu "Cek Pembayaran". Order online yang
    // BELUM lunas tidak ditampilkan ke barber sampai pembayaran terkonfirmasi
    // (via webhook/confirm). Cash & order yang sudah paid tetap tampil.
    const visible = data.filter((apt: any) => {
      if (apt.status !== 'pending' || apt.source !== 'online_booking') return true;
      const pays = Array.isArray(apt.payments) ? apt.payments : (apt.payments ? [apt.payments] : []);
      return pays.some((p: any) => p.status === 'paid' || p.method === 'cash');
    });

    return Promise.all(visible.map(formatBarberQueueOrder));
  }

  static async getBarberAppointmentHistory(
    staffId: string,
    query: { page?: number | string; limit?: number | string } = {}
  ) {
    const [barber] = await db
      .select({ id: barbers.id })
      .from(barbers)
      .where(and(eq(barbers.staffUserId, staffId), isNull(barbers.deletedAt)))
      .limit(1);

    if (!barber) {
      throw new Error('Profil barber tidak ditemukan');
    }

    const limit = normalizeLimit(query.limit);
    const page = normalizePage(query.page);
    const offset = (page - 1) * limit;

    const historyWhere = and(eq(appointments.barberId, barber.id), inArray(appointments.status, BARBER_HISTORY_STATUSES as any));
    const [countResult, baseRows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(appointments).where(historyWhere),
      db
        .select({
          id: appointments.id,
          status: appointments.status,
          scheduled_at: appointments.scheduledAt,
          completed_at: appointments.completedAt,
          created_at: appointments.createdAt,
          fulfillment_type: appointments.fulfillmentType,
          service_address: appointments.serviceAddress,
          customer_media_urls: appointments.customerMediaUrls,
          customer_id: appointments.customerId
        })
        .from(appointments)
        .where(historyWhere)
        .orderBy(desc(appointments.createdAt))
        .limit(limit)
        .offset(offset)
    ]);

    const hydrated = await hydrateBarberOrders(snakeKeys(baseRows) as any[]);
    const total = Number(countResult[0]?.count ?? 0);
    return {
      data: hydrated.map(formatBarberHistoryOrder),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) }
    };
  }

  static async updateDestinationAdmin(appointmentId: string, lat: number, lng: number) {
    if (lat == null || lat === 0 || lng == null || lng === 0) {
      throw new Error('Titik potong/lokasi harus diisi');
    }
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error('destination_latitude tidak valid');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('destination_longitude tidak valid');
    }

    const [apt] = snakeKeys(
      await db
        .select({
          id: appointments.id,
          branch_id: appointments.branchId,
          barber_id: appointments.barberId,
          fulfillment_type: appointments.fulfillmentType,
          status: appointments.status,
          destination_latitude: appointments.destinationLatitude,
          destination_longitude: appointments.destinationLongitude
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1)
    ) as any[];

    if (!apt) {
      const err: any = new Error('Appointment tidak ditemukan');
      err.status = 404;
      throw err;
    }
    if (apt.fulfillment_type !== 'home_service') {
      throw new Error('Hanya appointment home_service yang dapat mengubah lokasi tujuan');
    }
    const MODIFIABLE_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];
    if (!MODIFIABLE_STATUSES.includes(apt.status)) {
      throw new Error(`Lokasi tidak dapat diubah saat status appointment adalah ${apt.status}`);
    }

    await BranchServiceAreaService.assertBranchCanServeLocation(
      apt.branch_id,
      { lat: latitude, lng: longitude },
      {
        barberId: apt.barber_id,
        source: 'admin_update_destination'
      }
    );

    await db
      .update(appointments)
      .set({ destinationLatitude: String(latitude), destinationLongitude: String(longitude) })
      .where(eq(appointments.id, appointmentId));
    const [updated] = snakeKeys(await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1));

    return { apt: updated, before: { destination_latitude: apt.destination_latitude, destination_longitude: apt.destination_longitude } };
  }

  static async updateDestination(
    appointmentId: string,
    customerId: string,
    lat: number,
    lng: number
  ) {
    if (lat == null || lat === 0 || lng == null || lng === 0) {
      throw new Error('Titik potong/lokasi harus diisi');
    }
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error('destination_latitude tidak valid');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('destination_longitude tidak valid');
    }

    const [apt] = snakeKeys(
      await db
        .select({
          id: appointments.id,
          customer_id: appointments.customerId,
          branch_id: appointments.branchId,
          barber_id: appointments.barberId,
          fulfillment_type: appointments.fulfillmentType,
          status: appointments.status
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1)
    ) as any[];

    if (!apt) {
      const err: any = new Error('Appointment tidak ditemukan');
      err.status = 404;
      throw err;
    }
    if (apt.customer_id !== customerId) {
      const err: any = new Error('Appointment bukan milik Anda');
      err.status = 403;
      throw err;
    }
    if (apt.fulfillment_type !== 'home_service') {
      throw new Error('Hanya appointment home_service yang dapat mengubah lokasi tujuan');
    }
    const MODIFIABLE_STATUSES = ['pending', 'confirmed', 'in_queue'];
    if (!MODIFIABLE_STATUSES.includes(apt.status)) {
      throw new Error(`Lokasi tidak dapat diubah saat status appointment adalah ${apt.status}`);
    }

    await BranchServiceAreaService.assertBranchCanServeLocation(
      apt.branch_id,
      { lat: latitude, lng: longitude },
      {
        barberId: apt.barber_id,
        customerId,
        source: 'customer_update_destination'
      }
    );

    await db
      .update(appointments)
      .set({ destinationLatitude: String(latitude), destinationLongitude: String(longitude) })
      .where(eq(appointments.id, appointmentId));
    const [updated] = snakeKeys(await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1));
    return updated;
  }

  static async updateAppointmentStatus(id: string, newStatus: string, metadata: {
    actor: AppointmentActor;
    reason: string;
    event_type?: 'STATUS_TRANSITION' | 'ORDER_ACCEPTANCE_TIMEOUT' | 'APPOINTMENT_NO_SHOW_TIMEOUT';
    customer_media_urls?: string[];
  }) {
    return AppointmentLifecycleService.transition(id, newStatus, {
      actor: metadata.actor,
      reason: metadata.reason,
      event_type: metadata.event_type,
      customer_media_urls: metadata.customer_media_urls
    });
  }
}
