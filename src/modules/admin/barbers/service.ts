import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { barbers, staffUsers, appointments, customers, appointmentServices, services } from '../../../db/schema';
import { and, eq, isNull, inArray, gte, lte, notInArray, asc } from 'drizzle-orm';
import { redis, getBarberStatusKey } from '../../../lib/redis';

const VALID_STATUSES = ['available', 'serving', 'on_break', 'offline'] as const;
type BarberStatus = typeof VALID_STATUSES[number];
const ACTIVE_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];

export class AdminBarbersService {
  static async listBranchBarbers(branchId: string) {
    const rows = await db
      .select({
        id: barbers.id,
        display_name: barbers.displayName,
        live_status: barbers.liveStatus,
        bio: barbers.bio,
        rating_avg: barbers.ratingAvg,
        rating_count: barbers.ratingCount,
        staffFullName: staffUsers.fullName,
        staffPhone: staffUsers.phone
      })
      .from(barbers)
      .leftJoin(staffUsers, eq(barbers.staffUserId, staffUsers.id))
      .where(and(eq(barbers.branchId, branchId), isNull(barbers.deletedAt)))
      .orderBy(asc(barbers.displayName));

    const barberList = rows.map((b) => ({
      id: b.id,
      display_name: b.display_name,
      live_status: b.live_status,
      bio: b.bio,
      rating_avg: b.rating_avg,
      rating_count: b.rating_count,
      staff_users: { full_name: b.staffFullName, phone: b.staffPhone }
    }));

    const barberIds = barberList.map((b) => b.id);
    const activeCounts = barberIds.length
      ? await db
          .select({ barber_id: appointments.barberId })
          .from(appointments)
          .where(and(inArray(appointments.barberId, barberIds), inArray(appointments.status, ACTIVE_STATUSES as any)))
      : [];

    const countMap: Record<string, number> = {};
    activeCounts.forEach((a) => {
      if (a.barber_id) countMap[a.barber_id] = (countMap[a.barber_id] ?? 0) + 1;
    });

    return Promise.all(
      barberList.map(async (b) => {
        let liveStatus = b.live_status ?? 'offline';
        try {
          const redisStatus = await redis.get(getBarberStatusKey(b.id));
          if (redisStatus) liveStatus = redisStatus;
        } catch {
          /* fallback ke DB */
        }
        return { ...b, live_status: liveStatus, active_appointment_count: countMap[b.id] ?? 0 };
      })
    );
  }

  static async getBarberSchedule(barberId: string, branchId: string, date: string) {
    const [barber] = await db
      .select({ id: barbers.id, display_name: barbers.displayName, live_status: barbers.liveStatus })
      .from(barbers)
      .where(and(eq(barbers.id, barberId), eq(barbers.branchId, branchId), isNull(barbers.deletedAt)))
      .limit(1);

    if (!barber) {
      const err = new Error('Barber tidak ditemukan di cabang ini') as any;
      err.status = 404;
      throw err;
    }

    const dateStart = `${date}T00:00:00.000Z`;
    const dateEnd = `${date}T23:59:59.999Z`;

    const apptRows = snakeKeys(
      await db
        .select({
          id: appointments.id,
          status: appointments.status,
          source: appointments.source,
          scheduledAt: appointments.scheduledAt,
          scheduledEndAt: appointments.scheduledEndAt,
          scheduleBlockStartAt: appointments.scheduleBlockStartAt,
          scheduleBlockEndAt: appointments.scheduleBlockEndAt,
          queuePosition: appointments.queuePosition,
          customerId: appointments.customerId,
          custId: customers.id,
          custFullName: customers.fullName,
          custPhone: customers.phone
        })
        .from(appointments)
        .leftJoin(customers, eq(appointments.customerId, customers.id))
        .where(
          and(
            eq(appointments.barberId, barberId),
            gte(appointments.scheduleBlockStartAt, dateStart),
            lte(appointments.scheduleBlockStartAt, dateEnd),
            notInArray(appointments.status, ['cancelled'])
          )
        )
        .orderBy(asc(appointments.scheduleBlockStartAt))
    ) as any[];

    const apptIds = apptRows.map((a) => a.id);
    const svcRows = apptIds.length
      ? await db
          .select({
            appointmentId: appointmentServices.appointmentId,
            serviceName: services.name,
            defaultDurationMin: services.defaultDurationMin
          })
          .from(appointmentServices)
          .leftJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(inArray(appointmentServices.appointmentId, apptIds))
      : [];
    const svcByAppt: Record<string, any[]> = {};
    for (const s of svcRows) {
      (svcByAppt[s.appointmentId] ??= []).push({
        services: { name: s.serviceName, default_duration_min: s.defaultDurationMin }
      });
    }

    const appointmentsOut = apptRows.map((a) => ({
      id: a.id,
      status: a.status,
      source: a.source,
      scheduled_at: a.scheduled_at,
      scheduled_end_at: a.scheduled_end_at,
      schedule_block_start_at: a.schedule_block_start_at,
      schedule_block_end_at: a.schedule_block_end_at,
      queue_position: a.queue_position,
      customers: a.cust_id ? { id: a.cust_id, full_name: a.cust_full_name, phone: a.cust_phone } : null,
      appointment_services: svcByAppt[a.id] ?? []
    }));

    let liveStatus = barber.live_status ?? 'offline';
    try {
      const redisStatus = await redis.get(getBarberStatusKey(barberId));
      if (redisStatus) liveStatus = redisStatus;
    } catch {
      /* fallback */
    }

    return { barber: { ...barber, live_status: liveStatus }, date, appointments: appointmentsOut };
  }

  static async setBarberStatus(barberId: string, branchId: string, status: string) {
    if (!VALID_STATUSES.includes(status as BarberStatus)) {
      const err = new Error(`Status harus salah satu dari: ${VALID_STATUSES.join(', ')}`) as any;
      err.status = 400;
      throw err;
    }

    const [barber] = await db
      .select({ id: barbers.id })
      .from(barbers)
      .where(and(eq(barbers.id, barberId), eq(barbers.branchId, branchId), isNull(barbers.deletedAt)))
      .limit(1);

    if (!barber) {
      const err = new Error('Barber tidak ditemukan di cabang ini') as any;
      err.status = 404;
      throw err;
    }

    await db.update(barbers).set({ liveStatus: status }).where(eq(barbers.id, barberId));

    await redis.set(getBarberStatusKey(barberId), status);

    return { barber_id: barberId, status };
  }
}
