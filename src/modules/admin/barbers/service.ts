import { supabase } from '../../../lib/supabase';
import { redis, getBarberStatusKey } from '../../../lib/redis';

const VALID_STATUSES = ['available', 'serving', 'on_break', 'offline'] as const;
type BarberStatus = typeof VALID_STATUSES[number];

export class AdminBarbersService {
  static async listBranchBarbers(branchId: string) {
    const { data: barbers, error } = await supabase
      .from('barbers')
      .select('id, display_name, live_status, bio, rating_avg, rating_count, staff_users(full_name, phone)')
      .eq('branch_id', branchId)
      .is('deleted_at', null)
      .order('display_name');

    if (error) throw new Error(error.message);

    const barberIds = (barbers ?? []).map((b: any) => b.id);
    const { data: activeCounts } = barberIds.length
      ? await supabase
          .from('appointments')
          .select('barber_id')
          .in('barber_id', barberIds)
          .in('status', ['pending', 'confirmed', 'in_queue', 'in_service'])
      : { data: [] };

    const countMap: Record<string, number> = {};
    (activeCounts ?? []).forEach((a: any) => {
      countMap[a.barber_id] = (countMap[a.barber_id] ?? 0) + 1;
    });

    return Promise.all(
      (barbers ?? []).map(async (b: any) => {
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
    const { data: barber } = await supabase
      .from('barbers')
      .select('id, display_name, live_status')
      .eq('id', barberId)
      .eq('branch_id', branchId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!barber) {
      const err = new Error('Barber tidak ditemukan di cabang ini') as any;
      err.status = 404;
      throw err;
    }

    // Filter berdasarkan schedule_block_start_at di UTC untuk tanggal yang diberikan
    const dateStart = `${date}T00:00:00.000Z`;
    const dateEnd = `${date}T23:59:59.999Z`;

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select(`
        id, status, source, scheduled_at, scheduled_end_at,
        schedule_block_start_at, schedule_block_end_at,
        queue_position,
        customers(id, full_name, phone),
        appointment_services(services(name, default_duration_min))
      `)
      .eq('barber_id', barberId)
      .gte('schedule_block_start_at', dateStart)
      .lte('schedule_block_start_at', dateEnd)
      .not('status', 'in', '(cancelled)')
      .order('schedule_block_start_at');

    if (error) throw new Error(error.message);

    let liveStatus = barber.live_status ?? 'offline';
    try {
      const redisStatus = await redis.get(getBarberStatusKey(barberId));
      if (redisStatus) liveStatus = redisStatus;
    } catch { /* fallback */ }

    return { barber: { ...barber, live_status: liveStatus }, date, appointments: appointments ?? [] };
  }

  static async setBarberStatus(barberId: string, branchId: string, status: string) {
    if (!VALID_STATUSES.includes(status as BarberStatus)) {
      const err = new Error(`Status harus salah satu dari: ${VALID_STATUSES.join(', ')}`) as any;
      err.status = 400;
      throw err;
    }

    const { data: barber } = await supabase
      .from('barbers')
      .select('id')
      .eq('id', barberId)
      .eq('branch_id', branchId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!barber) {
      const err = new Error('Barber tidak ditemukan di cabang ini') as any;
      err.status = 404;
      throw err;
    }

    const { error } = await supabase
      .from('barbers')
      .update({ live_status: status, updated_at: new Date().toISOString() })
      .eq('id', barberId);

    if (error) throw new Error(error.message);

    await redis.set(getBarberStatusKey(barberId), status);

    return { barber_id: barberId, status };
  }
}
