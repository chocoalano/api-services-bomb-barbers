/**
 * Port dari create_appointment_atomic & transition_appointment_status_atomic.
 * Fitur DB lama tanpa padanan langsung di MySQL dan penggantinya:
 *   - advisory lock                    -> GET_LOCK()/RELEASE_LOCK()
 *   - unique partial idempotency_key   -> unique index + cek existing
 *   - EXCLUDE gist (schedule overlap)  -> cek overlap manual di bawah lock
 *   - AT TIME ZONE 'Asia/Jakarta'      -> perhitungan offset UTC+7 di JS
 *   - haversine (earthdistance)        -> haversineMeters() di JS
 *   - RETURNING                        -> SELECT setelah write
 */
import { sql } from 'drizzle-orm';
import { randomUUID, createHash } from 'crypto';
import { db } from '../lib/db';
import {
  ProcedureError,
  toSqlUtc,
  toJakartaLocal,
  haversineMeters,
  timeToMinutes,
  parseDbTime,
  ACTIVE_STATUSES
} from './procedures';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const APPOINTMENT_STATUSES = [
  'pending', 'confirmed', 'in_queue', 'in_service', 'completed', 'cancelled', 'no_show'
];

async function rows<T = any>(tx: Tx, query: any): Promise<T[]> {
  const res: any = await tx.execute(query);
  return (Array.isArray(res) ? res[0] : res) as T[];
}
async function one<T = any>(tx: Tx, query: any): Promise<T | null> {
  return (await rows<T>(tx, query))[0] ?? null;
}
// Nama user-level lock MySQL dibatasi 64 karakter, jadi di-hash agar muat
// (pengganti advisory lock lama).
function hashLock(raw: string): string {
  return 'bb:' + createHash('md5').update(raw).digest('hex'); // 3 + 32 = 35 char
}
async function getLock(tx: Tx, name: string, timeout = 10) {
  const r = await one<{ v: number }>(tx, sql`SELECT GET_LOCK(${hashLock(name)}, ${timeout}) AS v`);
  if (!r || Number(r.v) !== 1) throw new ProcedureError('Gagal mengambil lock (sistem sibuk)', '55P03');
}
async function releaseLock(tx: Tx, name: string) {
  await tx.execute(sql`SELECT RELEASE_LOCK(${hashLock(name)})`);
}

function toDate(v: Date | string | null | undefined, field = 'tanggal/waktu'): Date | null {
  if (v == null) return null;
  const date = v instanceof Date ? v : parseDbTime(v);
  if (Number.isNaN(date.getTime())) {
    throw new ProcedureError(`${field} tidak valid`, '22023');
  }
  return date;
}

interface CreateAppointmentParams {
  branchId: string;
  barberId: string | null;
  customerId: string | null;
  serviceIds: string[];
  scheduledAt: Date | string | null;
  source: string; // 'online_booking' | 'walk_in'
  idempotencyKey: string;
  actorType: string; // 'customer' | 'staff'
  actorId: string;
  customerMediaUrls?: any[];
  fulfillmentType?: string; // 'in_store' | 'home_service'
  serviceAddress?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  locationNotes?: string | null;
  travelBufferMin?: number;
}

export async function createAppointmentAtomic(params: CreateAppointmentParams) {
  const key = (params.idempotencyKey ?? '').trim();
  if (key.length < 8 || key.length > 128)
    throw new ProcedureError('Idempotency-Key wajib berisi 8 sampai 128 karakter', '22023');

  const source = params.source;
  const fulfillmentType = params.fulfillmentType || 'in_store';
  const mediaUrls = params.customerMediaUrls ?? [];
  const scheduledAt = toDate(params.scheduledAt, 'scheduled_at') ?? new Date();
  const tolerance =
    Number(process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER) || 0.5;

  return db.transaction(async (tx) => {
    const idempoLock = `appointment-idempotency:${key}`;
    await getLock(tx, idempoLock);
    try {
      const existing = await one(
        tx,
        sql`SELECT * FROM appointments WHERE idempotency_key = ${key}`
      );
      if (existing) {
        if (
          existing.branch_id !== params.branchId ||
          (existing.barber_id ?? null) !== (params.barberId ?? null) ||
          (existing.customer_id ?? null) !== (params.customerId ?? null) ||
          existing.source !== source
        ) {
          throw new ProcedureError('Idempotency-Key sudah digunakan untuk request berbeda', '23505');
        }
        return existing;
      }

      if (source !== 'online_booking' && source !== 'walk_in')
        throw new ProcedureError('source appointment tidak valid', '22023');
      if ((params.actorType !== 'customer' && params.actorType !== 'staff') || !params.actorId)
        throw new ProcedureError('Actor pembuat appointment tidak valid', '22023');
      if (
        source === 'online_booking' &&
        (!params.customerId || params.actorType !== 'customer' || params.actorId !== params.customerId)
      )
        throw new ProcedureError('Booking online wajib dibuat oleh customer pemilik appointment', '42501');

      const uniqueServiceIds = Array.from(new Set(params.serviceIds ?? []));
      if (uniqueServiceIds.length === 0 || uniqueServiceIds.length !== (params.serviceIds ?? []).length)
        throw new ProcedureError('Minimal satu service unik wajib dipilih', '22023');
      if (!Array.isArray(mediaUrls))
        throw new ProcedureError('customer_media_urls wajib berupa array JSON', '22023');

      const branch = await one(
        tx,
        sql`SELECT * FROM branches WHERE id = ${params.branchId} AND deleted_at IS NULL AND is_active = true`
      );
      if (!branch) throw new ProcedureError('Cabang tidak ditemukan atau tidak aktif', 'P0002');

      if (source === 'online_booking' && scheduledAt.getTime() <= Date.now())
        throw new ProcedureError('Booking online tidak boleh dibuat untuk waktu yang sudah lewat', '22023');

      if (fulfillmentType !== 'in_store' && fulfillmentType !== 'home_service')
        throw new ProcedureError('fulfillment_type harus in_store atau home_service', '22023');

      let barber: any = null;
      if (params.barberId) {
        barber = await one(
          tx,
          sql`SELECT b.* FROM barbers b JOIN staff_users s ON s.id = b.staff_user_id
              WHERE b.id = ${params.barberId} AND b.branch_id = ${params.branchId}
                AND b.deleted_at IS NULL AND s.deleted_at IS NULL AND s.is_active = true`
        );
        if (!barber)
          throw new ProcedureError('Barber tidak aktif atau tidak berasal dari cabang yang dipilih', 'P0002');
      } else if (fulfillmentType === 'home_service') {
        throw new ProcedureError('barber_id wajib dipilih untuk home_service', '22023');
      }

      if (fulfillmentType === 'home_service') {
        const lat = params.destinationLatitude;
        const lon = params.destinationLongitude;
        if (
          !params.serviceAddress?.trim() ||
          lat == null || lon == null ||
          lat < -90 || lat > 90 || lon < -180 || lon > 180
        )
          throw new ProcedureError('Alamat dan koordinat tujuan yang valid wajib untuk home_service', '22023');
        if (branch.latitude == null || branch.longitude == null)
          throw new ProcedureError('Koordinat cabang belum dikonfigurasi', '22023');

        const distance = haversineMeters(Number(branch.latitude), Number(branch.longitude), lat, lon);
        const radiusM = (Number(barber?.service_radius_km ?? 5) * 1000) + tolerance;
        if (distance > radiusM)
          throw new ProcedureError('Lokasi customer berada di luar radius layanan barber', '22023');
      }

      // Harga + total durasi
      let totalDuration = 0;
      const priced: { serviceId: string; price: number; duration: number }[] = [];
      for (const serviceId of uniqueServiceIds) {
        const service = await one(
          tx,
          sql`SELECT * FROM services WHERE id = ${serviceId} AND is_active = true AND deleted_at IS NULL`
        );
        if (!service)
          throw new ProcedureError(`Layanan ${serviceId} tidak ditemukan atau tidak aktif`, 'P0002');

        const price = await resolvePrice(tx, serviceId, params.branchId, branch.region_id, scheduledAt);
        if (price == null)
          throw new ProcedureError(`Harga layanan ${serviceId} tidak tersedia pada jadwal tersebut`, 'P0002');

        const duration = Math.max(Number(service.default_duration_min), 1);
        totalDuration += duration;
        priced.push({ serviceId, price, duration });
      }

      const scheduledEndAt = new Date(scheduledAt.getTime() + totalDuration * 60_000);
      const bufferMin =
        fulfillmentType === 'home_service'
          ? Math.max(0, Math.min(params.travelBufferMin ?? 15, 120))
          : 0;

      // Jam operasional (waktu lokal Jakarta)
      const localStart = toJakartaLocal(scheduledAt);
      const localEnd = toJakartaLocal(scheduledEndAt);
      const dow = localStart.getUTCDay(); // 0=Minggu .. 6=Sabtu (sama dgn extract(dow))
      const oh = await one(
        tx,
        sql`SELECT open_time, close_time FROM branch_operating_hours
            WHERE branch_id = ${params.branchId} AND day_of_week = ${dow}
            ORDER BY created_at DESC LIMIT 1`
      );
      const sameDay =
        localStart.getUTCFullYear() === localEnd.getUTCFullYear() &&
        localStart.getUTCMonth() === localEnd.getUTCMonth() &&
        localStart.getUTCDate() === localEnd.getUTCDate();
      const startMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
      const endMin = localEnd.getUTCHours() * 60 + localEnd.getUTCMinutes();
      if (
        !oh || !sameDay ||
        startMin < timeToMinutes(String(oh.open_time)) ||
        endMin > timeToMinutes(String(oh.close_time))
      )
        throw new ProcedureError('Jadwal berada di luar jam operasional cabang', '22023');

      // Cuti barber (overlap dgn buffer)
      if (params.barberId) {
        const blockStart = new Date(scheduledAt.getTime() - bufferMin * 60_000);
        const blockEnd = new Date(scheduledEndAt.getTime() + bufferMin * 60_000);
        const timeOff = await one(
          tx,
          sql`SELECT 1 FROM barber_time_off
              WHERE barber_id = ${params.barberId} AND status IN ('approved','active')
                AND start_at < ${toSqlUtc(blockEnd)} AND end_at > ${toSqlUtc(blockStart)} LIMIT 1`
        );
        if (timeOff) throw new ProcedureError('Barber sedang tidak tersedia pada jadwal tersebut', 'P0001');
      }

      // Lock antrean / kapasitas (branch + barber)
      const queueLock = `appointment-queue:${params.branchId}:${params.barberId ?? 'unassigned'}`;
      await getLock(tx, queueLock);
      try {
        const scheduleBlockStart = new Date(scheduledAt.getTime() - bufferMin * 60_000);
        const scheduleBlockEnd = new Date(scheduledEndAt.getTime() + bufferMin * 60_000);

        if (params.barberId) {
          // Pengganti EXCLUDE gist: tak boleh overlap dgn appointment aktif barber sama.
          const overlap = await one(
            tx,
            sql`SELECT 1 FROM appointments
                WHERE barber_id = ${params.barberId} AND status IN ('pending','confirmed','in_queue','in_service')
                  AND scheduled_at IS NOT NULL AND scheduled_end_at IS NOT NULL
                  AND schedule_block_start_at IS NOT NULL AND schedule_block_end_at IS NOT NULL
                  AND schedule_block_start_at < ${toSqlUtc(scheduleBlockEnd)}
                  AND schedule_block_end_at > ${toSqlUtc(scheduleBlockStart)} LIMIT 1`
          );
          if (overlap)
            throw new ProcedureError('Barber sudah memiliki appointment yang overlap pada jadwal tersebut', '23P01');
        } else {
          // Pengganti trigger enforce_branch_capacity_for_unassigned.
          const activeBarbers = await one<{ c: number }>(
            tx,
            sql`SELECT COUNT(*) AS c FROM barbers WHERE branch_id = ${params.branchId} AND deleted_at IS NULL`
          );
          const nBarbers = Number(activeBarbers?.c ?? 0);
          if (nBarbers === 0)
            throw new ProcedureError('Cabang belum memiliki barber aktif untuk melayani booking', 'P0002');
          const overlapCount = await one<{ c: number }>(
            tx,
            sql`SELECT COUNT(*) AS c FROM appointments
                WHERE branch_id = ${params.branchId} AND status IN ('pending','confirmed','in_queue','in_service')
                  AND scheduled_at < ${toSqlUtc(scheduledEndAt)} AND scheduled_end_at > ${toSqlUtc(scheduledAt)}`
          );
          if (Number(overlapCount?.c ?? 0) >= nBarbers)
            throw new ProcedureError('Kapasitas cabang penuh pada jadwal tersebut', '23P01');
        }

        // Posisi antrean
        const q = await one<{ pos: number }>(
          tx,
          sql`SELECT COALESCE(MAX(queue_position),0) + 1 AS pos FROM appointments
              WHERE branch_id = ${params.branchId}
                AND ${params.barberId ? sql`barber_id = ${params.barberId}` : sql`barber_id IS NULL`}
                AND status IN ('pending','confirmed','in_queue','in_service')`
        );
        const queuePosition = Number(q?.pos ?? 1);
        const status = source === 'walk_in' ? 'in_queue' : 'pending';

        const appointmentId = randomUUID();
        const isHome = fulfillmentType === 'home_service';
        await tx.execute(sql`
          INSERT INTO appointments (
            id, branch_id, barber_id, customer_id, source, status, scheduled_at, scheduled_end_at,
            queue_position, customer_media_urls, fulfillment_type, service_address,
            destination_latitude, destination_longitude, location_notes, travel_buffer_min,
            idempotency_key, schedule_block_start_at, schedule_block_end_at
          ) VALUES (
            ${appointmentId}, ${params.branchId}, ${params.barberId}, ${params.customerId}, ${source}, ${status},
            ${toSqlUtc(scheduledAt)}, ${toSqlUtc(scheduledEndAt)}, ${queuePosition},
            ${JSON.stringify(mediaUrls)}, ${fulfillmentType},
            ${isHome ? params.serviceAddress?.trim() ?? null : null},
            ${isHome ? params.destinationLatitude ?? null : null},
            ${isHome ? params.destinationLongitude ?? null : null},
            ${params.locationNotes?.trim() || null}, ${bufferMin}, ${key},
            ${toSqlUtc(scheduleBlockStart)}, ${toSqlUtc(scheduleBlockEnd)}
          )
        `);

        for (const p of priced) {
          await tx.execute(sql`
            INSERT INTO appointment_services (id, appointment_id, service_id, price_amount, duration_min)
            VALUES (${randomUUID()}, ${appointmentId}, ${p.serviceId}, ${p.price}, ${p.duration})
          `);
        }

        await tx.execute(sql`
          INSERT INTO appointment_events (
            id, appointment_id, event_type, from_status, to_status, actor_type, actor_id, actor_role, reason, metadata
          ) VALUES (
            ${randomUUID()}, ${appointmentId}, 'APPOINTMENT_CREATED', NULL, ${status}, ${params.actorType}, ${params.actorId},
            ${params.actorType === 'customer' ? 'customer' : 'admin'},
            ${source === 'walk_in' ? 'Appointment walk-in dibuat' : 'Booking online dibuat'},
            ${JSON.stringify({
              source,
              idempotency_key: key,
              scheduled_end_at: scheduledEndAt.toISOString(),
              travel_buffer_min: bufferMin
            })}
          )
        `);

        return one(tx, sql`SELECT * FROM appointments WHERE id = ${appointmentId}`);
      } finally {
        await releaseLock(tx, queueLock);
      }
    } finally {
      await releaseLock(tx, idempoLock);
    }
  });
}

async function resolvePrice(
  tx: Tx,
  serviceId: string,
  branchId: string,
  regionId: string | null,
  scheduledAt: Date
): Promise<number | null> {
  const at = toSqlUtc(scheduledAt);
  const row = await one(
    tx,
    sql`SELECT price_amount FROM service_prices
        WHERE service_id = ${serviceId}
          AND effective_from <= ${at}
          AND (effective_to IS NULL OR effective_to >= ${at})
          AND (branch_id = ${branchId} OR region_id = ${regionId} OR (branch_id IS NULL AND region_id IS NULL))
        ORDER BY
          CASE WHEN branch_id = ${branchId} THEN 1 WHEN region_id = ${regionId} THEN 2 ELSE 3 END,
          effective_from DESC
        LIMIT 1`
  );
  return row ? Number(row.price_amount) : null;
}

interface TransitionParams {
  appointmentId: string;
  targetStatus: string;
  expectedVersion: number;
  actorType: string; // customer|staff|system
  actorId: string | null;
  actorRole: string | null;
  reason: string;
  eventType?: string;
  customerMediaUrls?: any[] | null;
}

const TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['in_queue', 'in_service', 'cancelled', 'no_show'],
  in_queue: ['in_service', 'cancelled', 'no_show'],
  in_service: ['completed']
};

export async function transitionAppointmentStatusAtomic(params: TransitionParams) {
  const reason = (params.reason ?? '').trim();
  if (!reason) throw new ProcedureError('Reason wajib disertakan pada setiap transisi status', '22023');
  if (!['customer', 'staff', 'system'].includes(params.actorType))
    throw new ProcedureError('actor_type tidak valid', '22023');
  if (params.actorType !== 'system' && !params.actorId)
    throw new ProcedureError('actor_id wajib untuk actor non-system', '22023');
  if (!APPOINTMENT_STATUSES.includes(params.targetStatus))
    throw new ProcedureError('Status tujuan tidak valid', '22023');

  const target = params.targetStatus;
  const eventType = (params.eventType ?? '').trim() || 'STATUS_TRANSITION';

  return db.transaction(async (tx) => {
    const current = await one(
      tx,
      sql`SELECT * FROM appointments WHERE id = ${params.appointmentId} FOR UPDATE`
    );
    if (!current) throw new ProcedureError('Appointment tidak ditemukan', 'P0002');
    if (Number(current.version) !== Number(params.expectedVersion))
      throw new ProcedureError('Status appointment berubah oleh proses lain, muat ulang data terbaru', '40001');
    if (current.status === target) return current;

    const allowed = (TRANSITIONS[current.status] ?? []).includes(target);
    if (!allowed)
      throw new ProcedureError(`Transisi status ${current.status} ke ${target} tidak diizinkan`, '22023');

    if (params.actorType === 'customer') {
      if ((current.customer_id ?? null) !== params.actorId || target !== 'cancelled')
        throw new ProcedureError('Customer hanya dapat membatalkan appointment miliknya', '42501');
    }
    if (target === 'confirmed' && (params.actorType !== 'staff' || !['barber', 'admin'].includes(params.actorRole ?? '')))
      throw new ProcedureError('Status confirmed hanya dapat diberikan barber atau admin', '42501');

    if (params.actorType === 'system') {
      if (eventType === 'ORDER_ACCEPTANCE_TIMEOUT' && !(current.status === 'pending' && target === 'cancelled'))
        throw new ProcedureError('ORDER_ACCEPTANCE_TIMEOUT hanya berlaku untuk appointment pending', '22023');
      if (
        eventType === 'APPOINTMENT_NO_SHOW_TIMEOUT' &&
        !(['confirmed', 'in_queue'].includes(current.status) && target === 'no_show')
      )
        throw new ProcedureError('APPOINTMENT_NO_SHOW_TIMEOUT hanya berlaku untuk appointment confirmed/in_queue', '22023');
    }

    const now = toSqlUtc(new Date());
    const isCancel = target === 'cancelled' || target === 'no_show';
    const mediaProvided = params.customerMediaUrls != null;

    const res: any = await tx.execute(sql`
      UPDATE appointments SET
        status = ${target},
        version = version + 1,
        updated_at = ${now},
        started_at = ${target === 'in_service' ? sql`COALESCE(started_at, ${now})` : sql`started_at`},
        completed_at = ${target === 'completed' ? sql`COALESCE(completed_at, ${now})` : sql`completed_at`},
        cancellation_reason = ${isCancel ? reason : sql`cancellation_reason`},
        queue_position = ${isCancel ? sql`NULL` : sql`queue_position`},
        journey_status = ${
          target === 'completed' ? 'completed' : isCancel ? 'cancelled' : sql`journey_status`
        },
        customer_media_urls = ${mediaProvided ? JSON.stringify(params.customerMediaUrls) : sql`customer_media_urls`}
      WHERE id = ${params.appointmentId} AND version = ${params.expectedVersion}
    `);
    const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
    if (!affected)
      throw new ProcedureError('Status appointment berubah oleh proses lain, muat ulang data terbaru', '40001');

    const updated = await one(tx, sql`SELECT * FROM appointments WHERE id = ${params.appointmentId}`);

    await tx.execute(sql`
      INSERT INTO appointment_events (
        id, appointment_id, event_type, from_status, to_status, actor_type, actor_id, actor_role, reason, metadata
      ) VALUES (
        ${randomUUID()}, ${params.appointmentId}, ${eventType}, ${current.status}, ${target},
        ${params.actorType}, ${params.actorId}, ${params.actorRole}, ${reason},
        ${JSON.stringify({ previous_version: Number(current.version), new_version: Number(updated.version) })}
      )
    `);

    return updated;
  });
}
