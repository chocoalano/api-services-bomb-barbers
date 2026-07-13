import { db } from '../../../lib/db';
import {
  branches,
  services as servicesTable,
  branchOperatingHours,
  barbers as barbersTable,
  appointments as appointmentsTable,
  barberTimeOff
} from '../../../db/schema';
import { and, eq, isNull, inArray, notInArray, gte, lt, gt } from 'drizzle-orm';
import { OpenOrderService } from '../../../core/appointments/open-order.service';
import { sweepExpiredUnpaidPendingOrders } from '../../../core/appointments/service';
import { BOOKING_CONFIG, jakartaParts, minutesToTime } from '../../../config/booking';
import {
  BranchServiceAreaService,
  normalizeLocation
} from '../../../core/branches/service-area.service';
import { logger } from '../../../lib/logger';

type AvailableSlotsQuery = {
  date: string;
  service_ids: string[] | string;
  barber_id?: string;
  slot_interval_min?: number | string;
  fulfillment_type?: 'in_store' | 'home_service';
  travel_buffer_min?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
};

type AppointmentBlock = {
  barber_id: string | null;
  start: Date;
  end: Date;
};

type TimeOffBlock = {
  barber_id: string;
  start: Date;
  end: Date;
};

// [SPEC BOOKING] Semua konstanta operasional dari satu sumber: src/config/booking.ts.
// Jam kerja default 08:00–22:00. Customer memilih jam per KELIPATAN 1 JAM
// (08:00,09:00,…22:00 inklusif). Setiap order menempati blok 2 jam pada Barber.
const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];
const DEFAULT_OPEN_TIME = `${minutesToTime(BOOKING_CONFIG.operationalStartMinutes)}:00`;
const DEFAULT_CLOSE_TIME = `${minutesToTime(BOOKING_CONFIG.operationalLastBookingMinutes)}:00`;
const DEFAULT_SLOT_INTERVAL_MIN = BOOKING_CONFIG.customerBookingIntervalMinutes;
const BARBER_BLOCK_MIN = BOOKING_CONFIG.barberBlockMinutes;
const IDLE_BARBER_STATUSES = BOOKING_CONFIG.idleBarberStatuses;
const MAX_ORDERS_PER_BARBER_PER_DAY = BOOKING_CONFIG.maxDailyOrdersPerBarber;
const DEFAULT_TIMEZONE_OFFSET = BOOKING_CONFIG.timezoneOffset;

const normalizeServiceIds = (value: string[] | string) => {
  const raw = Array.isArray(value) ? value : value.split(',');
  const ids = raw.map((item) => item.trim()).filter(Boolean);

  if (ids.length === 0) {
    throw new Error('Minimal satu service_ids wajib dikirim');
  }

  return Array.from(new Set(ids));
};

const normalizeInterval = (value?: number | string) => {
  // [REVISI B7] Default 120 menit (kelipatan 2 jam). Nilai lain tetap boleh
  // dikirim eksplisit (5–120) untuk kebutuhan khusus.
  if (value === undefined || value === null || value === '') return DEFAULT_SLOT_INTERVAL_MIN;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 120) {
    throw new Error('slot_interval_min harus berupa angka 5 sampai 120 menit');
  }

  return Math.floor(parsed);
};

const normalizeTravelBuffer = (
  fulfillmentType: 'in_store' | 'home_service',
  value?: number | string
) => {
  if (fulfillmentType === 'in_store') return 0;
  if (value === undefined || value === null || value === '') {
    return Number(process.env.HOME_SERVICE_TRAVEL_BUFFER_MINUTES || 15);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 120) {
    throw new Error('travel_buffer_min harus berupa angka 0 sampai 120 menit');
  }

  return Math.floor(parsed);
};

const parseBookingDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date wajib menggunakan format YYYY-MM-DD');
  }

  const parsed = new Date(`${date}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('date tidak valid');
  }

  return parsed;
};

const getDayOfWeek = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const normalizeTime = (time?: string | null) => {
  if (!time) return null;
  return time.length === 5 ? `${time}:00` : time;
};

const combineDateTime = (date: string, time: string) =>
  new Date(`${date}T${normalizeTime(time)}${DEFAULT_TIMEZONE_OFFSET}`);

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60 * 1000);

const overlaps = (startA: Date, endA: Date, startB: Date, endB: Date) =>
  startA < endB && endA > startB;

const isMissingRelationError = (error: any) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || error?.code === 'PGRST205' || message.includes('barber_time_off');
};

export class AvailabilityService {
  static async getAvailableSlots(branchId: string, query: AvailableSlotsQuery) {
    const date = query.date;
    const serviceIds = normalizeServiceIds(query.service_ids);
    const slotIntervalMin = normalizeInterval(query.slot_interval_min);
    const fulfillmentType = query.fulfillment_type || 'in_store';
    const travelBufferMin = normalizeTravelBuffer(
      fulfillmentType,
      query.travel_buffer_min
    );
    parseBookingDate(date);

    const [branch] = await db
      .select({ id: branches.id, name: branches.name, is_active: branches.isActive })
      .from(branches)
      .where(and(eq(branches.id, branchId), isNull(branches.deletedAt)))
      .limit(1);

    if (!branch || branch.is_active === false) {
      throw new Error('Cabang tidak ditemukan atau tidak aktif');
    }

    // [SELF-HEAL] Bersihkan order kedaluwarsa & belum dibayar di cabang ini
    // sebelum menghitung ketersediaan, agar slot yang tertahan order abandoned
    // kembali muncul walau BullMQ worker tidak berjalan. Non-fatal bila gagal.
    try {
      await sweepExpiredUnpaidPendingOrders({ branchId });
    } catch (err: any) {
      logger.error({ err, branchId }, '[Sweep] Gagal membersihkan order kedaluwarsa saat fetch slot');
    }

    const services = await db
      .select({ id: servicesTable.id, name: servicesTable.name, default_duration_min: servicesTable.defaultDurationMin })
      .from(servicesTable)
      .where(and(inArray(servicesTable.id, serviceIds), eq(servicesTable.isActive, true), isNull(servicesTable.deletedAt)));

    if (!services || services.length !== serviceIds.length) {
      throw new Error('Satu atau lebih layanan tidak ditemukan atau tidak aktif');
    }

    const durationMin = services.reduce((sum: number, service: any) => sum + Number(service.default_duration_min || 0), 0);
    if (durationMin <= 0) {
      throw new Error('Durasi layanan tidak valid');
    }

    const dayOfWeek = getDayOfWeek(date);
    const [operatingHour] = await db
      .select({ open_time: branchOperatingHours.openTime, close_time: branchOperatingHours.closeTime })
      .from(branchOperatingHours)
      .where(and(eq(branchOperatingHours.branchId, branchId), eq(branchOperatingHours.dayOfWeek, dayOfWeek)))
      .limit(1);

    const openTime = normalizeTime(operatingHour?.open_time) || DEFAULT_OPEN_TIME;
    const closeTime = normalizeTime(operatingHour?.close_time) || DEFAULT_CLOSE_TIME;
    const openAt = combineDateTime(date, openTime);
    const closeAt = combineDateTime(date, closeTime);

    if (closeAt <= openAt) {
      return {
        branch_id: branchId,
        date,
        timezone_offset: DEFAULT_TIMEZONE_OFFSET,
        service_ids: serviceIds,
        fulfillment_type: fulfillmentType,
        travel_buffer_min: travelBufferMin,
        duration_min: durationMin,
        slot_interval_min: slotIntervalMin,
        operating_hours: { open_time: openTime, close_time: closeTime },
        slots: []
      };
    }

    const barberConds = [
      eq(barbersTable.branchId, branchId),
      // [SPEC BOOKING] Hanya barber yang sudah dikonfirmasi admin.
      eq(barbersTable.approvalStatus, 'approved'),
      isNull(barbersTable.deletedAt)
    ];
    if (query.barber_id) barberConds.push(eq(barbersTable.id, query.barber_id));

    const allBarbers = await db
      .select({
        id: barbersTable.id,
        display_name: barbersTable.displayName,
        live_status: barbersTable.liveStatus,
        approval_status: barbersTable.approvalStatus
      })
      .from(barbersTable)
      .where(and(...barberConds));

    let eligibleRadiusBarberIds: Set<string> | null = null;
    const rawLat = query.latitude ?? query.lat;
    const rawLng = query.longitude ?? query.lng;
    if (rawLat !== undefined || rawLng !== undefined) {
      const customerLocation = normalizeLocation(rawLat, rawLng);
      const eligibleBarbers =
        await BranchServiceAreaService.getEligibleBarbersForBranch(
          branchId,
          customerLocation,
          { source: 'available_slots' }
        );
      eligibleRadiusBarberIds = new Set(
        eligibleBarbers.map((barber: any) => barber.id)
      );
    }

    // [SPEC BOOKING] "Open Order" = barber idle/online. Hanya barber idle yang
    // ditawarkan ke customer (auto maupun manual).
    const barbers = (allBarbers ?? []).filter((b: any) =>
      IDLE_BARBER_STATUSES.includes(String(b.live_status ?? '')) &&
      (!eligibleRadiusBarberIds || eligibleRadiusBarberIds.has(b.id))
    );

    if (!barbers || barbers.length === 0) {
      return {
        branch_id: branchId,
        date,
        timezone_offset: DEFAULT_TIMEZONE_OFFSET,
        service_ids: serviceIds,
        barber_id: query.barber_id || null,
        fulfillment_type: fulfillmentType,
        travel_buffer_min: travelBufferMin,
        duration_min: durationMin,
        slot_interval_min: slotIntervalMin,
        operating_hours: { open_time: openTime, close_time: closeTime },
        slots: []
      };
    }

    const barberIds = barbers.map((barber: any) => barber.id);
    const dayStart = new Date(`${date}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`);
    const dayEnd = addMinutes(dayStart, 24 * 60);

    // Ambil semua order non-cancelled hari itu: untuk hitung kuota harian (7)
    // sekaligus blok bentrok. Order completed di masa lalu tak akan overlap slot
    // mendatang, jadi aman ikut dihitung untuk blok.
    const appointments = await db
      .select({
        id: appointmentsTable.id,
        barber_id: appointmentsTable.barberId,
        scheduled_at: appointmentsTable.scheduledAt,
        scheduled_end_at: appointmentsTable.scheduledEndAt,
        schedule_block_start_at: appointmentsTable.scheduleBlockStartAt,
        schedule_block_end_at: appointmentsTable.scheduleBlockEndAt,
        status: appointmentsTable.status
      })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.branchId, branchId),
          notInArray(appointmentsTable.status, ['cancelled', 'no_show']),
          gte(appointmentsTable.scheduledAt, dayStart.toISOString()),
          lt(appointmentsTable.scheduledAt, dayEnd.toISOString())
        )
      );

    // [SPEC BOOKING] Kuota harian per barber (semua order non-cancelled hari itu).
    const dayOrderCount = new Map<string, number>();
    for (const appointment of appointments ?? []) {
      if (!appointment.barber_id) continue;
      dayOrderCount.set(
        appointment.barber_id,
        (dayOrderCount.get(appointment.barber_id) ?? 0) + 1
      );
    }
    const quotaExhausted = new Set<string>(
      [...dayOrderCount.entries()]
        .filter(([, count]) => count >= MAX_ORDERS_PER_BARBER_PER_DAY)
        .map(([barberId]) => barberId)
    );

    // Blok barber untuk tiap order = minimal 2 jam sejak mulai.
    const appointmentBlocks: AppointmentBlock[] = (appointments ?? [])
      .filter((appointment: any) => Boolean(appointment.scheduled_at)
        && ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status))
      .map((appointment: any) => {
        const blockStart = new Date(appointment.schedule_block_start_at || appointment.scheduled_at);
        const storedEnd = appointment.schedule_block_end_at || appointment.scheduled_end_at;
        const minBlockEnd = addMinutes(blockStart, BARBER_BLOCK_MIN);
        return {
          barber_id: appointment.barber_id,
          start: blockStart,
          end: storedEnd && new Date(storedEnd) > minBlockEnd ? new Date(storedEnd) : minBlockEnd
        };
      });

    let timeOffBlocks: TimeOffBlock[] = [];
    try {
      const timeOff = await db
        .select({
          barber_id: barberTimeOff.barberId,
          start_at: barberTimeOff.startAt,
          end_at: barberTimeOff.endAt,
          status: barberTimeOff.status
        })
        .from(barberTimeOff)
        .where(
          and(
            inArray(barberTimeOff.barberId, barberIds),
            lt(barberTimeOff.startAt, closeAt.toISOString()),
            gt(barberTimeOff.endAt, openAt.toISOString())
          )
        );

      timeOffBlocks = timeOff
        .filter((item: any) => !item.status || ['approved', 'active'].includes(item.status))
        .map((item: any) => ({
          barber_id: item.barber_id,
          start: new Date(item.start_at),
          end: new Date(item.end_at)
        }));
    } catch (timeOffError: any) {
      if (!isMissingRelationError(timeOffError)) {
        throw new Error('Gagal mengambil data cuti barber');
      }
    }

    // [SPEC BOOKING §5/§10/§11] Muat periode Open Order barber untuk tanggal ini
    // sekali saja. Barber hanya ditawarkan pada slot yang masuk periode Open Order-nya.
    const openOrderContext = await OpenOrderService.loadContext(branchId, date);

    const now = new Date();
    const slots = [];
    // [SPEC BOOKING] Slot per KELIPATAN 1 JAM, mulai 08:00 s/d 22:00 (inklusif).
    // Tiap slot menempati blok 2 jam pada Barber (durasi layanan maksimal).
    for (let slotStart = new Date(openAt); slotStart <= closeAt; slotStart = addMinutes(slotStart, slotIntervalMin)) {
      const slotEnd = addMinutes(slotStart, durationMin);
      // Blok Barber yang dibutuhkan order ini = 2 jam sejak mulai.
      const requestedBlockStart = slotStart;
      const requestedBlockEnd = addMinutes(slotStart, BARBER_BLOCK_MIN);
      if (slotStart <= now) continue;

      // Jam booking lokal ('HH:MM') slot ini → dipetakan ke periode Open Order.
      const { minutes: slotMinutes } = jakartaParts(slotStart);
      const slotBookingTime = minutesToTime(slotMinutes);

      const unavailableBarberIds = new Set<string>(quotaExhausted);
      let genericAppointmentCount = 0;

      for (const block of appointmentBlocks) {
        if (!overlaps(requestedBlockStart, requestedBlockEnd, block.start, block.end)) continue;
        if (block.barber_id) unavailableBarberIds.add(block.barber_id);
        else genericAppointmentCount += 1;
      }

      for (const block of timeOffBlocks) {
        if (overlaps(requestedBlockStart, requestedBlockEnd, block.start, block.end)) {
          unavailableBarberIds.add(block.barber_id);
        }
      }

      const availableBarbers = barbers.filter((barber: any) =>
        !unavailableBarberIds.has(barber.id)
        && OpenOrderService.isBarberOpen(openOrderContext, barber.id, slotBookingTime));
      const availableCount = query.barber_id
        ? availableBarbers.length
        : Math.max(availableBarbers.length - genericAppointmentCount, 0);

      if (availableCount <= 0) continue;

      slots.push({
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        // [SPEC BOOKING §6] Customer memilih JAM MULAI per 1 jam (08:00, 09:00, …,
        // 22:00). Label = jam mulai saja; JANGAN turunkan dari durasi layanan
        // (durasi 45/60 menit tidak boleh mengubah kelipatan slot menjadi :45).
        time: slotBookingTime,
        label: slotBookingTime,
        available_barber_count: availableCount,
        available_barber_ids: availableBarbers.slice(0, availableCount).map((barber: any) => barber.id)
      });
    }

    return {
      branch_id: branchId,
      date,
      timezone_offset: DEFAULT_TIMEZONE_OFFSET,
      service_ids: serviceIds,
      barber_id: query.barber_id || null,
      fulfillment_type: fulfillmentType,
      travel_buffer_min: travelBufferMin,
      duration_min: durationMin,
      slot_interval_min: slotIntervalMin,
      operating_hours: { open_time: openTime, close_time: closeTime },
      slots
    };
  }
}
