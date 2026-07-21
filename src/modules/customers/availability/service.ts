import { db } from '../../../lib/db';
import {
  branches,
  services as servicesTable,
  branchOperatingHours,
  barbers as barbersTable,
  staffUsers,
  appointments as appointmentsTable,
  barberTimeOff
} from '../../../db/schema';
import { and, eq, ne, isNull, inArray, notInArray, gte, lt, gt, asc } from 'drizzle-orm';
import { OpenOrderService } from '../../../core/appointments/open-order.service';
import { sweepExpiredUnpaidPendingOrders } from '../../../core/appointments/service';
import {
  BOOKING_CONFIG,
  INACTIVE_APPOINTMENT_STATUSES,
  ACTIVE_APPOINTMENT_STATUSES,
  addMinutes,
  earliestBookableAt,
  jakartaParts,
  minutesToTime
} from '../../../config/booking';
import {
  blockOf,
  computeScheduleBlock,
  evaluateBarber,
  fitsOperatingWindow,
  lastBookableStartMinutes,
  rangesOverlap,
  resolveOperatingWindow,
  type BarberSnapshot,
  type TimeRange
} from '../../../core/booking/rules';
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
  /** Appointment yang dikecualikan dari perhitungan (dipakai saat EDIT jadwal
   * order: order itu sendiri tidak boleh menghitung dirinya sebagai "sibuk"). */
  exclude_appointment_id?: string;
};

// [SPEC BOOKING] Semua konstanta operasional dari satu sumber: src/config/booking.ts.
// Jam kerja default 08:00–22:00. Customer memilih jam per KELIPATAN 1 JAM
// (08:00,09:00,…22:00 inklusif). Setiap order menempati blok 2 jam pada Barber.
//
// [E1–E8] Seluruh PREDIKAT ("boleh/tidak") kini berasal dari
// `core/booking/rules` — generator ini adalah dry-run dari penegak, bukan
// implementasi paralel. Jangan menuliskan ulang perbandingan jam/kuota/blok di
// berkas ini.
const DEFAULT_SLOT_INTERVAL_MIN = BOOKING_CONFIG.customerBookingIntervalMinutes;
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
  // [REVISI B7] Default 60 menit (kelipatan 1 jam). Nilai lain tetap boleh
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

    // [E4] Cabang tanpa baris jam operasional: prosedur atomik SELALU menolak,
    // jadi generator berhenti berpura-pura punya slot. Fail-closed & terlihat
    // di log, bukan daftar slot palsu yang semuanya gagal saat submit.
    const window = resolveOperatingWindow(operatingHour ?? null);
    const emptyResponse = (reason: string) => {
      if (reason) logger.warn({ branchId, date, reason }, '[Slots] Daftar slot kosong');
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
        min_lead_minutes: BOOKING_CONFIG.minCustomerLeadMinutes,
        min_bookable_at: earliestBookableAt(new Date()).toISOString(),
        operating_hours: window
          ? { open_time: minutesToTime(window.openMin), close_time: minutesToTime(window.closeMin) }
          : null,
        slots: [] as any[]
      };
    };

    if (!window) {
      return emptyResponse('BRANCH_HOURS_MISSING');
    }

    // [E3] Join staff_users: prosedur atomik mensyaratkan staff aktif, jadi
    // barber dengan staff nonaktif tidak boleh muncul di daftar slot maupun
    // terpilih auto-assign. `orderBy` membuat hasilnya deterministik (E6).
    const barberConds = [
      eq(barbersTable.branchId, branchId),
      // [SPEC BOOKING] Hanya barber yang sudah dikonfirmasi admin.
      eq(barbersTable.approvalStatus, 'approved'),
      isNull(barbersTable.deletedAt)
    ];
    if (query.barber_id) barberConds.push(eq(barbersTable.id, query.barber_id));

    const barberRows = await db
      .select({
        id: barbersTable.id,
        display_name: barbersTable.displayName,
        live_status: barbersTable.liveStatus,
        approval_status: barbersTable.approvalStatus,
        staff_is_active: staffUsers.isActive,
        staff_deleted_at: staffUsers.deletedAt
      })
      .from(barbersTable)
      .leftJoin(staffUsers, eq(barbersTable.staffUserId, staffUsers.id))
      .where(and(...barberConds))
      .orderBy(asc(barbersTable.id));

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

    const barbers: BarberSnapshot[] = (barberRows ?? []).map((row: any) => ({
      id: row.id,
      live_status: row.live_status,
      approval_status: row.approval_status,
      // leftJoin: barber tanpa baris staff dianggap aktif (data lama), sama
      // seperti perlakuan katalog.
      staff_active: row.staff_is_active !== false && row.staff_deleted_at == null
    }));

    if (barbers.length === 0) {
      return emptyResponse('NO_BARBER_IN_BRANCH');
    }

    const barberIds = barbers.map((barber) => barber.id);
    const dayStart = new Date(`${date}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`);
    const dayEnd = addMinutes(dayStart, 24 * 60);

    // Saat EDIT jadwal sebuah order, order tsb tidak boleh menghitung dirinya
    // sebagai "sibuk" — kalau tidak, slot jam order itu sendiri (dan tetangganya
    // dalam blok 2 jam) akan hilang dari daftar edit. Kecualikan dari blok
    // bentrok DAN kuota harian sekaligus lewat WHERE ini.
    const rawExcludeId =
      typeof query.exclude_appointment_id === 'string' ? query.exclude_appointment_id.trim() : '';
    const excludeAppointmentId = rawExcludeId.length > 0 ? rawExcludeId : null;

    // [E7] Kuota & bentrok dihitung LINTAS CABANG, sama seperti penegak
    // (`countBarberOrdersForDay`/`barberHasConflict`). Dulu generator memfilter
    // per cabang sehingga menawarkan slot yang pasti ditolak BARBER_QUOTA_FULL.
    // Rentang diperlebar 1 hari ke belakang agar blok order yang mulai sebelum
    // tengah malam tetap terlihat.
    const barberAppointments = await db
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
          inArray(appointmentsTable.barberId, barberIds),
          notInArray(appointmentsTable.status, INACTIVE_APPOINTMENT_STATUSES as any),
          gte(appointmentsTable.scheduledAt, addMinutes(dayStart, -24 * 60).toISOString()),
          lt(appointmentsTable.scheduledAt, dayEnd.toISOString()),
          ...(excludeAppointmentId ? [ne(appointmentsTable.id, excludeAppointmentId)] : [])
        )
      );

    // Order tanpa barber (belum di-assign) tetap memakan kapasitas cabang.
    const genericAppointments = await db
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
          isNull(appointmentsTable.barberId),
          notInArray(appointmentsTable.status, INACTIVE_APPOINTMENT_STATUSES as any),
          gte(appointmentsTable.scheduledAt, addMinutes(dayStart, -24 * 60).toISOString()),
          lt(appointmentsTable.scheduledAt, dayEnd.toISOString()),
          ...(excludeAppointmentId ? [ne(appointmentsTable.id, excludeAppointmentId)] : [])
        )
      );

    // [SPEC BOOKING] Kuota harian per barber: semua order non-cancelled pada
    // TANGGAL yang diminta (bukan rentang diperlebar di atas).
    const dayOrderCount = new Map<string, number>();
    for (const appointment of barberAppointments ?? []) {
      if (!appointment.barber_id || !appointment.scheduled_at) continue;
      const startedAt = new Date(appointment.scheduled_at);
      if (startedAt < dayStart || startedAt >= dayEnd) continue;
      dayOrderCount.set(
        appointment.barber_id,
        (dayOrderCount.get(appointment.barber_id) ?? 0) + 1
      );
    }

    // [E5/E10/E11] Blok okupansi dari satu definisi (`blockOf`), termasuk baris
    // lama yang kolom `schedule_block_*`-nya kosong.
    const blocksByBarber = new Map<string, TimeRange[]>();
    for (const appointment of barberAppointments ?? []) {
      if (!appointment.barber_id) continue;
      if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as any)) continue;
      const block = blockOf(appointment as any);
      if (!block) continue;
      const list = blocksByBarber.get(appointment.barber_id) ?? [];
      list.push(block);
      blocksByBarber.set(appointment.barber_id, list);
    }

    const genericBlocks: TimeRange[] = (genericAppointments ?? [])
      .filter((appointment: any) => ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status))
      .map((appointment: any) => blockOf(appointment))
      .filter((block): block is TimeRange => block !== null);

    const openAt = new Date(dayStart.getTime() + window.openMin * 60_000);
    const closeAt = new Date(dayStart.getTime() + window.closeMin * 60_000);

    const timeOffByBarber = new Map<string, TimeRange[]>();
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
            lt(barberTimeOff.startAt, addMinutes(closeAt, BOOKING_CONFIG.barberBlockMinutes).toISOString()),
            gt(barberTimeOff.endAt, openAt.toISOString())
          )
        );

      for (const item of timeOff) {
        if (item.status && !['approved', 'active'].includes(item.status)) continue;
        const list = timeOffByBarber.get(item.barber_id) ?? [];
        list.push({ start: new Date(item.start_at), end: new Date(item.end_at) });
        timeOffByBarber.set(item.barber_id, list);
      }
    } catch (timeOffError: any) {
      if (!isMissingRelationError(timeOffError)) {
        throw new Error('Gagal mengambil data cuti barber');
      }
    }

    // [SPEC BOOKING §5/§10/§11] Muat periode Open Order barber untuk tanggal ini
    // sekali saja. Barber hanya ditawarkan pada slot yang masuk periode Open Order-nya.
    const openOrderContext = await OpenOrderService.loadContext(branchId, date);

    const now = new Date();
    // [SPEC BOOKING] Jeda minimal 6 jam: customer yang membuka aplikasi pukul
    // 08:00 hanya boleh memilih 14:00 ke atas. `minStart` selalu > now sehingga
    // filter "slot sudah lewat" ikut tercakup di sini.
    const minStart = earliestBookableAt(now);
    const slots = [];

    // [E1] Batas atas loop = jam MULAI terakhir yang layanannya masih selesai
    // sebelum jam tutup. Dulu loop berhenti di `closeAt` tanpa memperhitungkan
    // durasi, sehingga slot 22:00 untuk layanan 60 menit ditawarkan lalu
    // ditolak prosedur "di luar jam operasional".
    const lastStartAt = new Date(
      dayStart.getTime() + lastBookableStartMinutes(window, durationMin) * 60_000
    );

    for (let slotStart = new Date(openAt); slotStart <= lastStartAt; slotStart = addMinutes(slotStart, slotIntervalMin)) {
      if (slotStart < minStart) continue;
      // Sabuk pengaman: predikat yang sama dengan yang dipakai penegak.
      if (!fitsOperatingWindow(slotStart, durationMin, window).ok) continue;

      const slotEnd = addMinutes(slotStart, durationMin);
      const requestedBlock = computeScheduleBlock({
        startAt: slotStart,
        durationMin,
        travelBufferMin
      });

      // Jam booking lokal ('HH:MM') slot ini → dipetakan ke periode Open Order.
      const { minutes: slotMinutes } = jakartaParts(slotStart);
      const slotBookingTime = minutesToTime(slotMinutes);

      // [E2/E3/E5/E6/E7] Satu predikat untuk seluruh kandidat — persis yang
      // dijalankan penegak saat submit.
      const availableBarbers = barbers.filter((barber) =>
        evaluateBarber({
          barber,
          requestedBlock,
          dayOrderCount: dayOrderCount.get(barber.id) ?? 0,
          existingBlocks: blocksByBarber.get(barber.id) ?? [],
          timeOff: timeOffByBarber.get(barber.id) ?? [],
          isOpenOrder: OpenOrderService.isBarberOpen(openOrderContext, barber.id, slotBookingTime),
          withinRadius: eligibleRadiusBarberIds ? eligibleRadiusBarberIds.has(barber.id) : undefined
        }).ok
      );

      const genericOverlap = genericBlocks.filter((block) =>
        rangesOverlap(requestedBlock, block)
      ).length;

      // Kapasitas efektif: barber bebas dikurangi order yang belum punya barber.
      const availableCount = query.barber_id
        ? availableBarbers.length
        : Math.max(availableBarbers.length - genericOverlap, 0);

      if (availableCount <= 0) continue;

      slots.push({
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        // [SPEC BOOKING §6] Customer memilih JAM MULAI per 1 jam (08:00, 09:00, …).
        // Label = jam mulai saja; JANGAN turunkan dari durasi layanan
        // (durasi 45/60 menit tidak boleh mengubah kelipatan slot menjadi :45).
        time: slotBookingTime,
        label: slotBookingTime,
        available_barber_count: availableCount,
        // [E6] Seluruh barber yang benar-benar bebas — tanpa `slice()` yang dulu
        // membuang kandidat berdasarkan urutan query yang tidak deterministik.
        // `available_barber_count` tetap kapasitas efektif dan bisa lebih kecil
        // dari panjang daftar ini bila ada order tanpa barber.
        available_barber_ids: availableBarbers.map((barber) => barber.id)
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
      // Jeda minimal booking + instant paling awal yang boleh dipilih. Dikirim
      // agar klien dapat menjelaskan mengapa daftar slot kosong/terpotong.
      min_lead_minutes: BOOKING_CONFIG.minCustomerLeadMinutes,
      min_bookable_at: minStart.toISOString(),
      operating_hours: {
        open_time: minutesToTime(window.openMin),
        close_time: minutesToTime(window.closeMin)
      },
      slots
    };
  }
}
