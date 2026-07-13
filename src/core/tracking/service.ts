import { randomUUID } from 'crypto';
import { db } from '../../lib/db';
import { snakeKeys, toDbDate } from '../../db/helpers';
import { isDuplicateKeyError } from '../../db/procedures';
import { trackingSessions, appointments, barbers, branches } from '../../db/schema';
import { and, eq, lte, gt, desc, isNull } from 'drizzle-orm';
import {
  getCustomerLocationKey,
  getLegacyAppointmentEtaKey,
  getTrackingBarberKey,
  getTrackingBarberSequenceKey,
  getTrackingCustomerKey,
  getTrackingCustomerSequenceKey,
  getTrackingRateLimitKey,
  getTrackingRouteKey,
  getTrackingSessionKey,
  redis
} from '../../lib/redis';

const LOCATION_TTL_SECONDS = Number(process.env.TRACKING_LOCATION_TTL_SECONDS || 120);
const SESSION_TTL_SECONDS = Number(process.env.TRACKING_SESSION_TTL_SECONDS || 14400);
const MAX_LOCATION_AGE_MS = Number(process.env.TRACKING_MAX_LOCATION_AGE_MS || 120000);
const MAX_FUTURE_SKEW_MS = Number(process.env.TRACKING_MAX_FUTURE_SKEW_MS || 30000);
const MAX_UPDATES_PER_WINDOW = Number(process.env.TRACKING_RATE_LIMIT_MAX || 10);
const RATE_LIMIT_WINDOW_SECONDS = Number(process.env.TRACKING_RATE_LIMIT_WINDOW_SECONDS || 2);
const MAX_JUMP_SPEED_MPS = Number(process.env.TRACKING_MAX_JUMP_SPEED_MPS || 100);
const MAX_GPS_ACCURACY_M = Number(process.env.TRACKING_MAX_GPS_ACCURACY_M || 100);
const DEFAULT_ROUTE_SPEED_KMH = Number(process.env.TRACKING_FALLBACK_SPEED_KMH || 25);
const CHECKIN_GEOFENCE_RADIUS_M = Number(process.env.CHECKIN_GEOFENCE_RADIUS_M || 500);
const ARRIVE_GEOFENCE_RADIUS_M = Number(process.env.ARRIVE_GEOFENCE_RADIUS_M || 300);
const ROUTING_API_URL = process.env.ROUTING_API_URL?.replace(/\/$/, '') || '';
const ROUTING_API_TOKEN = process.env.ROUTING_API_TOKEN || '';

export const TRACKABLE_APPOINTMENT_STATUSES = ['confirmed', 'in_queue'] as const;
const CUSTOMER_LOCATION_STATUSES = ['confirmed', 'in_queue'] as const;

export type TrackingActor = {
  role: 'customer' | 'staff';
  userId: string;
  barberId?: string | null;
};

export type LocationInput = {
  lat: number;
  lng: number;
  accuracy_m?: number;
  heading?: number;
  speed_mps?: number;
  captured_at?: string;
};

type AppointmentParticipant = {
  id: string;
  customer_id: string | null;
  barber_id: string | null;
  branch_id: string;
  status: string;
  fulfillment_type?: 'in_store' | 'home_service';
};

type StoredLocation = LocationInput & {
  appointment_id: string;
  actor_id: string;
  actor_type: 'customer' | 'barber';
  captured_at: string;
  received_at: string;
  sequence: number;
};

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const validateLocation = (input: LocationInput) => {
  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('Latitude harus berupa angka antara -90 dan 90');
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Longitude harus berupa angka antara -180 dan 180');
  }

  if (input.accuracy_m !== undefined) {
    const accuracy = Number(input.accuracy_m);
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1000) {
      throw new Error('accuracy_m harus berupa angka antara 0 dan 1000 meter');
    }
    if (accuracy > MAX_GPS_ACCURACY_M) {
      throw new Error(`Akurasi GPS terlalu rendah (${Math.round(accuracy)}m), diperlukan kurang dari ${MAX_GPS_ACCURACY_M}m`);
    }
  }

  if (input.heading !== undefined) {
    const heading = Number(input.heading);
    if (!Number.isFinite(heading) || heading < 0 || heading >= 360) {
      throw new Error('heading harus berupa angka antara 0 dan kurang dari 360');
    }
  }

  if (input.speed_mps !== undefined) {
    const speed = Number(input.speed_mps);
    if (!Number.isFinite(speed) || speed < 0 || speed > 100) {
      throw new Error('speed_mps harus berupa angka antara 0 dan 100');
    }
  }

  const now = Date.now();
  const capturedAt = input.captured_at ? new Date(input.captured_at) : new Date(now);
  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error('captured_at harus berupa timestamp ISO yang valid');
  }
  if (capturedAt.getTime() > now + MAX_FUTURE_SKEW_MS) {
    throw new Error('Lokasi tidak boleh memiliki waktu pengambilan di masa depan');
  }
  if (capturedAt.getTime() < now - MAX_LOCATION_AGE_MS) {
    throw new Error('Lokasi sudah terlalu lama dan harus diperbarui');
  }

  return {
    lat,
    lng,
    accuracy_m: input.accuracy_m === undefined ? undefined : Number(input.accuracy_m),
    heading: input.heading === undefined ? undefined : Number(input.heading),
    speed_mps: input.speed_mps === undefined ? undefined : Number(input.speed_mps),
    captured_at: capturedAt.toISOString()
  };
};

const haversineDistanceKm = (first: LocationInput, second: LocationInput) => {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = toRadians(second.lat - first.lat);
  const lngDelta = toRadians(second.lng - first.lng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(first.lat)) *
      Math.cos(toRadians(second.lat)) *
      Math.sin(lngDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const buildFallbackRouteSnapshot = (barber: StoredLocation, customer: StoredLocation) => {
  const distanceKm = haversineDistanceKm(barber, customer);
  const speedKmh = barber.speed_mps && barber.speed_mps > 1
    ? Math.max(barber.speed_mps * 3.6, 5)
    : DEFAULT_ROUTE_SPEED_KMH;
  const etaMinutes = Math.max(1, Math.ceil((distanceKm / speedKmh) * 60));

  return {
    source: 'haversine_fallback',
    distance_km: Number(distanceKm.toFixed(3)),
    eta_minutes: etaMinutes,
    calculated_at: new Date().toISOString(),
    barber_sequence: barber.sequence,
    customer_sequence: customer.sequence
  };
};

const calculateRouteSnapshot = async (
  barber: StoredLocation,
  customer: StoredLocation
) => {
  if (ROUTING_API_URL) {
    try {
      const coordinates = `${barber.lng},${barber.lat};${customer.lng},${customer.lat}`;
      const response = await fetch(
        `${ROUTING_API_URL}/route/v1/driving/${coordinates}?overview=false&steps=false`,
        {
          headers: ROUTING_API_TOKEN
            ? { Authorization: `Bearer ${ROUTING_API_TOKEN}` }
            : undefined,
          signal: AbortSignal.timeout(3000)
        }
      );
      const payload: any = await response.json();
      const route = payload?.routes?.[0];

      if (response.ok && route && Number.isFinite(route.distance) && Number.isFinite(route.duration)) {
        return {
          source: 'routing_provider',
          distance_km: Number((route.distance / 1000).toFixed(3)),
          eta_minutes: Math.max(1, Math.ceil(route.duration / 60)),
          calculated_at: new Date().toISOString(),
          barber_sequence: barber.sequence,
          customer_sequence: customer.sequence
        };
      }
    } catch {
      // Provider routing tidak tersedia: gunakan fallback deterministik.
    }
  }

  return buildFallbackRouteSnapshot(barber, customer);
};

export class RealtimeTrackingService {
  private static async touchSession(appointmentId: string) {
    const now = toDbDate(new Date());
    try {
      await db
        .update(trackingSessions)
        .set({ lastActivityAt: now, updatedAt: now } as any)
        .where(and(eq(trackingSessions.appointmentId, appointmentId), eq(trackingSessions.status, 'active')));
    } catch (error: any) {
      if (!String(error?.message ?? '').includes('last_activity_at')) {
        throw new Error(`Gagal memperbarui tracking session: ${error?.message}`);
      }
    }
  }

  static async setJourneyStatus(
    appointmentId: string,
    journeyStatus: 'not_started' | 'en_route' | 'arrived' | 'completed' | 'cancelled'
  ) {
    try {
      await db
        .update(appointments)
        .set({ journeyStatus } as any)
        .where(eq(appointments.id, appointmentId));
    } catch (error: any) {
      // Kompatibilitas sementara sebelum migration hardening diaplikasikan.
      if (!String(error?.message ?? '').includes('journey_status')) {
        throw new Error(`Gagal memperbarui journey status: ${error?.message}`);
      }
    }
  }

  static async resolveBarberId(staffUserId: string) {
    const [barber] = await db
      .select({ id: barbers.id })
      .from(barbers)
      .where(and(eq(barbers.staffUserId, staffUserId), isNull(barbers.deletedAt)))
      .limit(1);

    if (!barber) {
      throw new Error('Profil barber tidak ditemukan');
    }

    return barber.id;
  }

  static async getAppointment(appointmentId: string): Promise<AppointmentParticipant> {
    const [data] = snakeKeys(
      await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1)
    );

    if (!data) {
      throw new Error('Appointment tidak ditemukan');
    }

    return data as AppointmentParticipant;
  }

  static async authorizeParticipant(appointmentId: string, actor: TrackingActor) {
    const appointment = await this.getAppointment(appointmentId);

    if (actor.role === 'customer') {
      if (appointment.customer_id !== actor.userId) {
        throw new Error('Akses appointment ditolak');
      }
      return appointment;
    }

    const barberId = actor.barberId || await this.resolveBarberId(actor.userId);
    if (appointment.barber_id !== barberId) {
      throw new Error('Akses appointment ditolak');
    }

    return appointment;
  }

  static async getActiveSession(appointmentId: string) {
    const [session] = await db
      .select({
        id: trackingSessions.id,
        appointment_id: trackingSessions.appointmentId,
        status: trackingSessions.status,
        consent_given_at: trackingSessions.consentGivenAt,
        expires_at: trackingSessions.expiresAt,
        created_at: trackingSessions.createdAt,
        updated_at: trackingSessions.updatedAt
      })
      .from(trackingSessions)
      .where(and(eq(trackingSessions.appointmentId, appointmentId), eq(trackingSessions.status, 'active')))
      .orderBy(desc(trackingSessions.createdAt))
      .limit(1);

    if (!session) {
      throw new Error('Sesi tracking tidak aktif');
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await db
        .update(trackingSessions)
        .set({ status: 'expired' })
        .where(eq(trackingSessions.id, session.id));
      await this.cleanup(appointmentId);
      throw new Error('Sesi tracking telah kedaluwarsa');
    }

    return session;
  }

  static async startSession(appointmentId: string, customerId: string, consent: boolean) {
    if (!consent) {
      throw new Error('Tracking membutuhkan consent dari customer');
    }

    const appointment = await this.authorizeParticipant(appointmentId, {
      role: 'customer',
      userId: customerId
    });

    if (['completed', 'cancelled', 'no_show'].includes(appointment.status)) {
      throw new Error('Tracking hanya bisa dilakukan pada appointment yang masih aktif');
    }

    const now = new Date();
    await db
      .update(trackingSessions)
      .set({ status: 'expired' })
      .where(
        and(
          eq(trackingSessions.appointmentId, appointmentId),
          eq(trackingSessions.status, 'active'),
          lte(trackingSessions.expiresAt, now.toISOString())
        )
      );

    const [existing] = snakeKeys(
      await db
        .select()
        .from(trackingSessions)
        .where(
          and(
            eq(trackingSessions.appointmentId, appointmentId),
            eq(trackingSessions.status, 'active'),
            gt(trackingSessions.expiresAt, now.toISOString())
          )
        )
        .orderBy(desc(trackingSessions.createdAt))
        .limit(1)
    );

    if (existing) {
      await redis.setex(
        getTrackingSessionKey(appointmentId),
        SESSION_TTL_SECONDS,
        JSON.stringify({ id: existing.id, status: existing.status, expires_at: existing.expires_at })
      );
      return existing;
    }

    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
    const sessionId = randomUUID();
    try {
      await db.insert(trackingSessions).values({
        id: sessionId,
        appointmentId,
        status: 'active',
        consentGivenAt: toDbDate(now),
        expiresAt: toDbDate(expiresAt)
      } as any);
    } catch (error: any) {
      if (isDuplicateKeyError(error)) {
        return this.getActiveSession(appointmentId);
      }
      throw new Error(`Gagal memulai tracking session: ${error?.message || 'unknown'}`);
    }
    const [session] = snakeKeys(
      await db.select().from(trackingSessions).where(eq(trackingSessions.id, sessionId)).limit(1)
    );

    await redis.setex(
      getTrackingSessionKey(appointmentId),
      SESSION_TTL_SECONDS,
      JSON.stringify({ id: session.id, status: session.status, expires_at: session.expires_at })
    );

    return session;
  }

  private static async enforceRateLimit(
    actorType: 'customer' | 'barber',
    actorId: string,
    appointmentId: string
  ) {
    const key = getTrackingRateLimitKey(actorType, actorId, appointmentId);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    if (count > MAX_UPDATES_PER_WINDOW) {
      throw new Error('Terlalu banyak pembaruan lokasi, coba kembali beberapa saat lagi');
    }
  }

  private static async writeLocation(
    appointmentId: string,
    actorType: 'customer' | 'barber',
    actorId: string,
    input: LocationInput
  ) {
    const normalized = validateLocation(input);
    await this.enforceRateLimit(actorType, actorId, appointmentId);

    const sequenceKey = actorType === 'customer'
      ? getTrackingCustomerSequenceKey(appointmentId)
      : getTrackingBarberSequenceKey(appointmentId);
    const locationKey = actorType === 'customer'
      ? getTrackingCustomerKey(appointmentId)
      : getTrackingBarberKey(appointmentId);

    const prevRaw = await redis.get(locationKey);
    const prev = parseJson<StoredLocation>(prevRaw);
    if (prev) {
      const timeDeltaMs = new Date(normalized.captured_at).getTime() - new Date(prev.captured_at).getTime();
      if (timeDeltaMs <= 0) {
        throw new Error('Lokasi tidak valid: timestamp harus lebih baru dari lokasi sebelumnya');
      }
      const distanceKm = haversineDistanceKm(prev, { lat: normalized.lat, lng: normalized.lng });
      const speedMps = (distanceKm * 1000) / (timeDeltaMs / 1000);
      if (speedMps > MAX_JUMP_SPEED_MPS) {
        throw new Error('Lokasi tidak valid: kecepatan perpindahan tidak realistis');
      }
    }

    const sequence = await redis.incr(sequenceKey);
    await redis.expire(sequenceKey, SESSION_TTL_SECONDS);

    const location: StoredLocation = {
      appointment_id: appointmentId,
      actor_id: actorId,
      actor_type: actorType,
      ...normalized,
      received_at: new Date().toISOString(),
      sequence
    };

    await redis.setex(locationKey, LOCATION_TTL_SECONDS, JSON.stringify(location));
    await this.touchSession(appointmentId);

    // Legacy key hanya boleh merepresentasikan posisi barber agar endpoint lama
    // tidak dapat ditimpa oleh customer.
    if (actorType === 'barber') {
      await redis.setex(getLegacyAppointmentEtaKey(appointmentId), LOCATION_TTL_SECONDS, JSON.stringify(location));
    } else {
      await redis.setex(getCustomerLocationKey(appointmentId), LOCATION_TTL_SECONDS, JSON.stringify(location));
    }

    return location;
  }

  private static async refreshRoute(appointmentId: string) {
    const [barberRaw, customerRaw] = await Promise.all([
      redis.get(getTrackingBarberKey(appointmentId)),
      redis.get(getTrackingCustomerKey(appointmentId))
    ]);
    const barber = parseJson<StoredLocation>(barberRaw);
    let customer = parseJson<StoredLocation>(customerRaw);

    if (!customer) {
      const [destination] = await db
        .select({
          customer_id: appointments.customerId,
          destination_latitude: appointments.destinationLatitude,
          destination_longitude: appointments.destinationLongitude
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);

      if (
        destination &&
        destination.destination_latitude !== null &&
        destination.destination_longitude !== null
      ) {
        customer = {
          appointment_id: appointmentId,
          actor_id: destination.customer_id || 'destination_snapshot',
          actor_type: 'customer',
          lat: Number(destination.destination_latitude),
          lng: Number(destination.destination_longitude),
          captured_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          sequence: 0
        };
      }
    }

    if (!barber || !customer) {
      await redis.del(getTrackingRouteKey(appointmentId));
      return null;
    }

    const route = await calculateRouteSnapshot(barber, customer);
    await redis.setex(getTrackingRouteKey(appointmentId), LOCATION_TTL_SECONDS, JSON.stringify(route));
    return route;
  }

  static async updateCustomerLocation(
    appointmentId: string,
    customerId: string,
    input: LocationInput
  ) {
    const appointment = await this.authorizeParticipant(appointmentId, {
      role: 'customer',
      userId: customerId
    });
    await this.getActiveSession(appointmentId);

    if (appointment.fulfillment_type === 'in_store') {
      throw new Error('Live location customer hanya tersedia untuk appointment home_service');
    }
    if (!CUSTOMER_LOCATION_STATUSES.includes(appointment.status as any)) {
      throw new Error('Lokasi customer hanya dapat dibagikan selama appointment masih menunggu pelayanan');
    }

    const customerLocation = await this.writeLocation(
      appointmentId,
      'customer',
      customerId,
      input
    );
    const route = await this.refreshRoute(appointmentId);
    return { customer_location: customerLocation, route };
  }

  static async updateBarberLocation(
    appointmentId: string,
    staffUserId: string,
    input: LocationInput
  ) {
    const barberId = await this.resolveBarberId(staffUserId);
    const appointment = await this.authorizeParticipant(appointmentId, {
      role: 'staff',
      userId: staffUserId,
      barberId
    });
    await this.getActiveSession(appointmentId);

    if (appointment.fulfillment_type === 'in_store') {
      throw new Error('Live location barber hanya tersedia untuk appointment home_service');
    }
    if (!TRACKABLE_APPOINTMENT_STATUSES.includes(appointment.status as any)) {
      throw new Error('Lokasi barber hanya dapat dibagikan saat order confirmed atau in_queue');
    }

    const barberLocation = await this.writeLocation(
      appointmentId,
      'barber',
      barberId,
      input
    );
    await this.setJourneyStatus(appointmentId, 'en_route');
    const route = await this.refreshRoute(appointmentId);
    const customerLocation = parseJson<StoredLocation>(
      await redis.get(getTrackingCustomerKey(appointmentId))
    );

    return {
      barber_location: barberLocation,
      customer_location: customerLocation,
      route
    };
  }

  static async getSnapshot(appointmentId: string, customerId: string) {
    const appointment = await this.authorizeParticipant(appointmentId, {
      role: 'customer',
      userId: customerId
    });

    const [barberRaw, customerRaw, routeRaw, sessionRows, branchRows, barberRows] =
      await Promise.all([
        redis.get(getTrackingBarberKey(appointmentId)),
        redis.get(getTrackingCustomerKey(appointmentId)),
        redis.get(getTrackingRouteKey(appointmentId)),
        db
          .select({
            id: trackingSessions.id,
            status: trackingSessions.status,
            consent_given_at: trackingSessions.consentGivenAt,
            expires_at: trackingSessions.expiresAt,
            created_at: trackingSessions.createdAt
          })
          .from(trackingSessions)
          .where(and(eq(trackingSessions.appointmentId, appointmentId), eq(trackingSessions.status, 'active')))
          .orderBy(desc(trackingSessions.createdAt))
          .limit(1),
        db
          .select({ id: branches.id, name: branches.name, address: branches.address, latitude: branches.latitude, longitude: branches.longitude })
          .from(branches)
          .where(eq(branches.id, appointment.branch_id))
          .limit(1),
        appointment.barber_id
          ? db.select({ id: barbers.id, display_name: barbers.displayName }).from(barbers).where(eq(barbers.id, appointment.barber_id)).limit(1)
          : Promise.resolve([] as any[])
      ]);

    let barberLocation = parseJson<StoredLocation>(barberRaw);
    if (!barberLocation) {
      // Fallback hanya untuk data legacy yang ditulis barber.
      barberLocation = parseJson<StoredLocation>(
        await redis.get(getLegacyAppointmentEtaKey(appointmentId))
      );
    }
    const customerLocation = parseJson<StoredLocation>(customerRaw);
    const route = parseJson<any>(routeRaw);
    const session = sessionRows[0] ?? null;
    const expired = Boolean(session?.expires_at && new Date(session.expires_at) <= new Date());

    if (expired && session?.id) {
      await db.update(trackingSessions).set({ status: 'expired' }).where(eq(trackingSessions.id, session.id));
    }

    const branch = branchRows[0] ?? null;
    const branchLocation = branch && branch.latitude !== null && branch.longitude !== null
      ? { lat: Number(branch.latitude), lng: Number(branch.longitude) }
      : null;
    const visibleBarberLocation = barberLocation || branchLocation;

    return {
      appointment_id: appointmentId,
      appointment_status: appointment.status,
      tracking_status: expired ? 'expired' : session ? 'active' : 'not_started',
      session: session && !expired ? session : null,
      eta_minutes: route?.eta_minutes ?? null,
      distance_km: route?.distance_km ?? null,
      route_source: route?.source ?? null,
      updated_at: barberLocation?.received_at ?? null,
      is_live: Boolean(barberLocation),
      source: barberLocation ? 'redis' : branchLocation ? 'branch_fallback' : 'none',
      lat: visibleBarberLocation?.lat ?? null,
      lng: visibleBarberLocation?.lng ?? null,
      latitude: visibleBarberLocation?.lat ?? null,
      longitude: visibleBarberLocation?.lng ?? null,
      location: visibleBarberLocation,
      barber_location: barberLocation,
      customer_location: customerLocation,
      route,
      branch: branch ? {
        id: branch.id,
        name: branch.name,
        address: branch.address ?? null,
        latitude: branchLocation?.lat ?? null,
        longitude: branchLocation?.lng ?? null,
        location: branchLocation
      } : null,
      barber: barberRows[0] ? {
        id: barberRows[0].id,
        full_name: barberRows[0].display_name,
        display_name: barberRows[0].display_name,
        latitude: visibleBarberLocation?.lat ?? null,
        longitude: visibleBarberLocation?.lng ?? null,
        location: visibleBarberLocation
      } : null
    };
  }

  static async completeSession(
    appointmentId: string,
    status: 'completed' | 'expired' | 'revoked' = 'completed'
  ) {
    const endedAt = toDbDate(new Date());
    try {
      await db
        .update(trackingSessions)
        .set({ status, endedAt, endedReason: status } as any)
        .where(and(eq(trackingSessions.appointmentId, appointmentId), eq(trackingSessions.status, 'active')));
    } catch (error: any) {
      const msg = String(error?.message ?? '');
      if (msg.includes('ended_at') || msg.includes('ended_reason')) {
        await db
          .update(trackingSessions)
          .set({ status } as any)
          .where(and(eq(trackingSessions.appointmentId, appointmentId), eq(trackingSessions.status, 'active')));
      } else {
        throw new Error(`Gagal menyelesaikan tracking session: ${error?.message}`);
      }
    }

    await this.cleanup(appointmentId);
  }

  static async cleanup(appointmentId: string) {
    await redis.del(
      getLegacyAppointmentEtaKey(appointmentId),
      getCustomerLocationKey(appointmentId),
      getTrackingSessionKey(appointmentId),
      getTrackingCustomerKey(appointmentId),
      getTrackingBarberKey(appointmentId),
      getTrackingRouteKey(appointmentId),
      getTrackingCustomerSequenceKey(appointmentId),
      getTrackingBarberSequenceKey(appointmentId)
    );
  }

  static async validateCheckInGeofence(
    branchId: string,
    lat: number,
    lng: number
  ): Promise<number> {
    const [branch] = await db
      .select({ latitude: branches.latitude, longitude: branches.longitude })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (!branch || branch.latitude === null || branch.longitude === null) {
      return 0;
    }

    const distanceKm = haversineDistanceKm(
      { lat: Number(branch.latitude), lng: Number(branch.longitude) },
      { lat, lng }
    );
    const distanceM = distanceKm * 1000;

    if (distanceM > CHECKIN_GEOFENCE_RADIUS_M) {
      throw new Error(
        `Check-in GPS ditolak: terlalu jauh dari cabang (${Math.round(distanceM)}m, radius ${CHECKIN_GEOFENCE_RADIUS_M}m)`
      );
    }

    return distanceM;
  }

  static async validateArriveGeofence(
    appointmentId: string,
    lat: number,
    lng: number
  ): Promise<number> {
    const [apt] = await db
      .select({ destination_latitude: appointments.destinationLatitude, destination_longitude: appointments.destinationLongitude })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);

    if (!apt || apt.destination_latitude === null || apt.destination_longitude === null) {
      return 0;
    }

    const distanceKm = haversineDistanceKm(
      { lat: Number(apt.destination_latitude), lng: Number(apt.destination_longitude) },
      { lat, lng }
    );
    const distanceM = distanceKm * 1000;

    if (distanceM > ARRIVE_GEOFENCE_RADIUS_M) {
      throw new Error(
        `Barber belum berada dalam radius lokasi customer (${Math.round(distanceM)}m, radius ${ARRIVE_GEOFENCE_RADIUS_M}m)`
      );
    }

    return distanceM;
  }

  static async getBarberSnapshot(appointmentId: string, staffUserId: string) {
    const barberId = await this.resolveBarberId(staffUserId);
    await this.authorizeParticipant(appointmentId, {
      role: 'staff',
      userId: staffUserId,
      barberId
    });

    const [barberRaw, customerRaw, routeRaw, sessionRows] = await Promise.all([
      redis.get(getTrackingBarberKey(appointmentId)),
      redis.get(getTrackingCustomerKey(appointmentId)),
      redis.get(getTrackingRouteKey(appointmentId)),
      db
        .select({
          id: trackingSessions.id,
          status: trackingSessions.status,
          consent_given_at: trackingSessions.consentGivenAt,
          expires_at: trackingSessions.expiresAt,
          created_at: trackingSessions.createdAt
        })
        .from(trackingSessions)
        .where(and(eq(trackingSessions.appointmentId, appointmentId), eq(trackingSessions.status, 'active')))
        .orderBy(desc(trackingSessions.createdAt))
        .limit(1)
    ]);

    let barberLocation = parseJson<StoredLocation>(barberRaw);
    if (!barberLocation) {
      barberLocation = parseJson<StoredLocation>(
        await redis.get(getLegacyAppointmentEtaKey(appointmentId))
      );
    }
    const customerLocation = parseJson<StoredLocation>(customerRaw);
    const route = parseJson<any>(routeRaw);
    const session = sessionRows[0] ?? null;

    return {
      appointment_id: appointmentId,
      tracking_status: session ? 'active' : 'not_started',
      session: session || null,
      barber_location: barberLocation,
      customer_location: customerLocation,
      route,
      eta_minutes: route?.eta_minutes ?? null,
      distance_km: route?.distance_km ?? null
    };
  }
}
