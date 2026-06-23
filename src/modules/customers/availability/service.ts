import { supabase } from '../../../lib/supabase';

type AvailableSlotsQuery = {
  date: string;
  service_ids: string[] | string;
  barber_id?: string;
  slot_interval_min?: number | string;
  fulfillment_type?: 'in_store' | 'home_service';
  travel_buffer_min?: number | string;
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

const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];
const DEFAULT_OPEN_TIME = '09:00:00';
const DEFAULT_CLOSE_TIME = '21:00:00';
const DEFAULT_TIMEZONE_OFFSET = '+07:00';

const normalizeServiceIds = (value: string[] | string) => {
  const raw = Array.isArray(value) ? value : value.split(',');
  const ids = raw.map((item) => item.trim()).filter(Boolean);

  if (ids.length === 0) {
    throw new Error('Minimal satu service_ids wajib dikirim');
  }

  return Array.from(new Set(ids));
};

const normalizeInterval = (value?: number | string) => {
  if (value === undefined || value === null || value === '') return 30;

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

const formatTimeLabel = (date: Date) =>
  new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta'
  }).format(date);

const getAppointmentDuration = (appointment: any) => {
  const services = appointment.appointment_services ?? [];
  const total = services.reduce((sum: number, item: any) => sum + Number(item.duration_min || 0), 0);
  return total > 0 ? total : 30;
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

    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('id, name, is_active')
      .eq('id', branchId)
      .is('deleted_at', null)
      .single();

    if (branchError || !branch || branch.is_active === false) {
      throw new Error('Cabang tidak ditemukan atau tidak aktif');
    }

    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select('id, name, default_duration_min')
      .in('id', serviceIds)
      .eq('is_active', true)
      .is('deleted_at', null);

    if (servicesError) {
      throw new Error('Gagal mengambil data layanan');
    }

    if (!services || services.length !== serviceIds.length) {
      throw new Error('Satu atau lebih layanan tidak ditemukan atau tidak aktif');
    }

    const durationMin = services.reduce((sum: number, service: any) => sum + Number(service.default_duration_min || 0), 0);
    if (durationMin <= 0) {
      throw new Error('Durasi layanan tidak valid');
    }

    const dayOfWeek = getDayOfWeek(date);
    const { data: operatingHour } = await supabase
      .from('branch_operating_hours')
      .select('open_time, close_time')
      .eq('branch_id', branchId)
      .eq('day_of_week', dayOfWeek)
      .limit(1)
      .maybeSingle();

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

    let barberQuery = supabase
      .from('barbers')
      .select('id, display_name')
      .eq('branch_id', branchId)
      .is('deleted_at', null);

    if (query.barber_id) {
      barberQuery = barberQuery.eq('id', query.barber_id);
    }

    const { data: barbers, error: barbersError } = await barberQuery;
    if (barbersError) {
      throw new Error('Gagal mengambil data barber');
    }

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

    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('id, barber_id, scheduled_at, scheduled_end_at, schedule_block_start_at, schedule_block_end_at, status, appointment_services(duration_min)')
      .eq('branch_id', branchId)
      .in('status', ACTIVE_APPOINTMENT_STATUSES)
      .gte('scheduled_at', dayStart.toISOString())
      .lt('scheduled_at', dayEnd.toISOString());

    if (appointmentsError) {
      throw new Error('Gagal mengambil jadwal appointment');
    }

    const appointmentBlocks: AppointmentBlock[] = (appointments ?? [])
      .filter((appointment: any) => Boolean(appointment.scheduled_at))
      .map((appointment: any) => {
        const start = new Date(appointment.scheduled_at);
        return {
          barber_id: appointment.barber_id,
          start: new Date(appointment.schedule_block_start_at || appointment.scheduled_at),
          end: new Date(
            appointment.schedule_block_end_at
            || appointment.scheduled_end_at
            || addMinutes(start, getAppointmentDuration(appointment))
          )
        };
      });

    let timeOffBlocks: TimeOffBlock[] = [];
    const { data: timeOff, error: timeOffError } = await supabase
      .from('barber_time_off')
      .select('barber_id, start_at, end_at, status')
      .in('barber_id', barberIds)
      .lt('start_at', closeAt.toISOString())
      .gt('end_at', openAt.toISOString());

    if (timeOffError && !isMissingRelationError(timeOffError)) {
      throw new Error('Gagal mengambil data cuti barber');
    }

    if (!timeOffError) {
      timeOffBlocks = (timeOff ?? [])
        .filter((item: any) => !item.status || ['approved', 'active'].includes(item.status))
        .map((item: any) => ({
          barber_id: item.barber_id,
          start: new Date(item.start_at),
          end: new Date(item.end_at)
        }));
    }

    const now = new Date();
    const slots = [];
    for (let slotStart = new Date(openAt); addMinutes(slotStart, durationMin) <= closeAt; slotStart = addMinutes(slotStart, slotIntervalMin)) {
      const slotEnd = addMinutes(slotStart, durationMin);
      const requestedBlockStart = addMinutes(slotStart, -travelBufferMin);
      const requestedBlockEnd = addMinutes(slotEnd, travelBufferMin);
      if (slotStart <= now) continue;

      const unavailableBarberIds = new Set<string>();
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

      const availableBarbers = barbers.filter((barber: any) => !unavailableBarberIds.has(barber.id));
      const availableCount = query.barber_id
        ? availableBarbers.length
        : Math.max(availableBarbers.length - genericAppointmentCount, 0);

      if (availableCount <= 0) continue;

      slots.push({
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        label: `${formatTimeLabel(slotStart)} - ${formatTimeLabel(slotEnd)}`,
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
