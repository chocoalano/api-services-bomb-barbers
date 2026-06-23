import { supabase } from '../../lib/supabase';
import { scheduleAppointmentTimeouts } from '../../lib/queue';
import { getTrackingRouteKey, redis } from '../../lib/redis';
import { io, emitNewOrder } from '../../lib/socket';
import { AppointmentLifecycleService } from './lifecycle.service';

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
    total_service_amount: items.reduce((sum: number, item: any) => sum + Number(item.total_price || 0), 0),
    total_price: items.reduce((sum: number, item: any) => sum + Number(item.total_price || 0), 0),
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
    payment_status: appointment.payments?.[0]?.status ?? 'unpaid'
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
    address: pickupAddress ?? branch?.address ?? '',
    status: BARBER_STATUS_ALIASES[appointment.status] ?? appointment.status,
    raw_status: appointment.status,
    fulfillment_type: fulfillmentType,
    service_address: appointment.service_address ?? null,
    destination_location: buildLocation(appointment.destination_latitude, appointment.destination_longitude),
    location_notes: appointment.location_notes ?? null,
    customer_media_urls: appointment.customer_media_urls ?? [],
    journey_status: appointment.journey_status ?? 'not_started'
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

export class AppointmentService {
  /**
   * Membuat appointment dan snapshot layanan melalui satu transaksi PostgreSQL.
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

    if (fulfillmentType === 'home_service') {
      if (!payload.barber_id) {
        throw new Error('barber_id wajib dipilih untuk home_service');
      }
      if (!payload.service_address?.trim()) {
        throw new Error('service_address wajib diisi untuk home_service');
      }

      if (
        payload.destination_latitude == null || payload.destination_latitude === 0 ||
        payload.destination_longitude == null || payload.destination_longitude === 0
      ) {
        throw new Error('Titik potong/lokasi harus diisi');
      }

      const latitude = Number(payload.destination_latitude);
      const longitude = Number(payload.destination_longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new Error('destination_latitude tidak valid');
      }
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('destination_longitude tidak valid');
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from('appointments')
      .select(`
        *,
        appointment_services (
          service_id
        )
      `)
      .eq('idempotency_key', payload.idempotency_key.trim())
      .maybeSingle();

    if (existingError) {
      throw new Error(`Gagal memeriksa idempotency booking: ${existingError.message}`);
    }

    if (existing) {
      const requestedServices = [...payload.service_ids].sort();
      const existingServices = (existing.appointment_services ?? [])
        .map((item: any) => item.service_id)
        .sort();
      const sameRequest =
        existing.branch_id === payload.branch_id
        && existing.barber_id === (payload.barber_id || null)
        && existing.customer_id === (payload.customer_id || null)
        && existing.source === source
        && existing.fulfillment_type === fulfillmentType
        && (!payload.scheduled_at || existing.scheduled_at === payload.scheduled_at)
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

    const scheduledAt = payload.scheduled_at || new Date(
      Date.now() + (source === 'online_booking' ? 5 * 60_000 : 0)
    ).toISOString();
    const travelBufferMin = fulfillmentType === 'home_service'
      ? Number(process.env.HOME_SERVICE_TRAVEL_BUFFER_MINUTES || 15)
      : 0;

    const { data: appointment, error: aptError } = await (supabase as any)
      .rpc('create_appointment_atomic', {
        p_branch_id: payload.branch_id,
        p_barber_id: payload.barber_id || null,
        p_customer_id: payload.customer_id || null,
        p_service_ids: Array.from(new Set(payload.service_ids)),
        p_scheduled_at: scheduledAt,
        p_source: source,
        p_idempotency_key: payload.idempotency_key.trim(),
        p_actor_type: actor.type,
        p_actor_id: actor.id,
        p_customer_media_urls: payload.media_urls || [],
        p_fulfillment_type: fulfillmentType,
        p_service_address: payload.service_address?.trim() || null,
        p_destination_latitude: payload.destination_latitude ?? null,
        p_destination_longitude: payload.destination_longitude ?? null,
        p_location_notes: payload.location_notes?.trim() || null,
        p_travel_buffer_min: Number.isFinite(travelBufferMin) ? travelBufferMin : 15
      })
      .single();

    if (aptError || !appointment) {
      const error = new Error(
        aptError?.message || 'Gagal membuat appointment'
      ) as Error & { status?: number; code?: string };
      error.code = aptError?.code;
      error.status = ['23P01', '23505', 'P0001'].includes(aptError?.code)
        ? 409
        : aptError?.code === 'P0002'
          ? 404
          : aptError?.code === '42501'
            ? 403
            : 400;
      throw error;
    }

    await scheduleAppointmentTimeouts(appointment);

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

    return appointment;
  }

  static async getCustomerAppointments(customerId: string, query: CustomerAppointmentsQuery = {}) {
    const limit = normalizeLimit(query.limit);
    const page = normalizePage(query.page);
    const before = normalizeBefore(query.before);
    const statusFilter = normalizeBoolean(query.ongoing_only)
      ? ACTIVE_APPOINTMENT_STATUSES
      : normalizeStatusFilter(query.status);
    const offset = (page - 1) * limit;

    let appointmentsQuery = supabase
      .from('appointments')
      .select(`
        *,
        appointment_services (
          id,
          service_id,
          price_amount,
          duration_min,
          services (
            id,
            name,
            description,
            image_url
          )
        ),
        branches (
          id,
          name,
          address,
          latitude,
          longitude
        ),
        barbers (
          id,
          display_name,
          rating_avg,
          rating_count
        ),
        payments (
          status
        )
      `)
      .eq('customer_id', customerId)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusFilter.length > 0) {
      appointmentsQuery = appointmentsQuery.in('status', statusFilter);
    }

    if (before) {
      appointmentsQuery = appointmentsQuery.lt('created_at', before);
    }

    const { data, error } = await appointmentsQuery;

    if (error) throw new Error(error.message);
    return (data ?? []).map(formatCustomerAppointment);
  }

  static async getCustomerAppointmentDetail(customerId: string, appointmentId: string) {
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        appointment_services (
          id,
          service_id,
          price_amount,
          duration_min,
          services (
            id,
            name,
            description,
            image_url
          )
        ),
        branches (
          id,
          name,
          address,
          latitude,
          longitude
        ),
        barbers (
          id,
          display_name,
          rating_avg,
          rating_count
        ),
        payments (
          status
        )
      `)
      .eq('id', appointmentId)
      .eq('customer_id', customerId)
      .single();

    if (error || !data) {
      throw new Error('Pemesanan tidak ditemukan');
    }

    return formatCustomerAppointment(data);
  }

  static async getBarberDashboardQueue(staffId: string) {
    const { data: barber, error: barberError } = await supabase
      .from('barbers')
      .select('id')
      .eq('staff_user_id', staffId)
      .is('deleted_at', null)
      .single();

    if (barberError || !barber) {
      throw new Error('Profil barber tidak ditemukan');
    }

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id,
        branch_id,
        customer_id,
        status,
        scheduled_at,
        queue_position,
        created_at,
        source,
        fulfillment_type,
        service_address,
        destination_latitude,
        destination_longitude,
        location_notes,
        customer_media_urls,
        journey_status,
        customers (
          full_name
        ),
        branches (
          name,
          address
        ),
        appointment_services (
          price_amount,
          services (
            name
          )
        )
      `)
      .eq('barber_id', barber.id)
      .in('status', BARBER_QUEUE_STATUSES)
      .order('queue_position', { ascending: true, nullsFirst: false })
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error('Gagal mengambil antrean barber: ' + error.message);
    }

    return Promise.all((data ?? []).map(formatBarberQueueOrder));
  }

  static async getBarberAppointmentHistory(
    staffId: string,
    query: { page?: number | string; limit?: number | string } = {}
  ) {
    const { data: barber, error: barberError } = await supabase
      .from('barbers')
      .select('id')
      .eq('staff_user_id', staffId)
      .is('deleted_at', null)
      .single();

    if (barberError || !barber) {
      throw new Error('Profil barber tidak ditemukan');
    }

    const limit = normalizeLimit(query.limit);
    const page = normalizePage(query.page);
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('barber_id', barber.id)
        .in('status', BARBER_HISTORY_STATUSES),
      supabase
        .from('appointments')
        .select(`
          id,
          status,
          scheduled_at,
          completed_at,
          created_at,
          fulfillment_type,
          service_address,
          customer_media_urls,
          customers (full_name),
          appointment_services (
            price_amount,
            services (name)
          )
        `)
        .eq('barber_id', barber.id)
        .in('status', BARBER_HISTORY_STATUSES)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
    ]);

    if (dataResult.error) {
      throw new Error('Gagal mengambil riwayat appointment: ' + dataResult.error.message);
    }

    const total = countResult.count ?? 0;
    return {
      data: (dataResult.data ?? []).map(formatBarberHistoryOrder),
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

    const { data: apt, error: fetchErr } = await supabase
      .from('appointments')
      .select('id, branch_id, fulfillment_type, status, destination_latitude, destination_longitude')
      .eq('id', appointmentId)
      .maybeSingle();

    if (fetchErr || !apt) {
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

    const { data: updated, error: updateErr } = await supabase
      .from('appointments')
      .update({
        destination_latitude: latitude,
        destination_longitude: longitude,
        updated_at: new Date().toISOString()
      })
      .eq('id', appointmentId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);
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

    const { data: apt, error: fetchErr } = await supabase
      .from('appointments')
      .select('id, customer_id, fulfillment_type, status')
      .eq('id', appointmentId)
      .maybeSingle();

    if (fetchErr || !apt) {
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

    const { data: updated, error: updateErr } = await supabase
      .from('appointments')
      .update({
        destination_latitude: latitude,
        destination_longitude: longitude,
        updated_at: new Date().toISOString()
      })
      .eq('id', appointmentId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);
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
