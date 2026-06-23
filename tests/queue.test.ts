import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { supabase } from '../src/lib/supabase';
import { redis } from '../src/lib/redis';
import { QueueService } from '../src/modules/admin/queue/service';

describe('Realtime Queue Service', () => {
  let branchId = '';
  let staffId = '';
  let barberId = '';
  let activeAppointmentIds: string[] = [];
  let inactiveAppointmentIds: string[] = [];

  beforeAll(async () => {
    const suffix = crypto.randomUUID().split('-')[0];

    const { data: branch } = await supabase
      .from('branches')
      .insert({ name: `Queue Branch ${suffix}` })
      .select('id')
      .single();
    branchId = branch!.id;

    const { data: staff } = await supabase
      .from('staff_users')
      .insert({ full_name: 'Queue Barber', email: `queue-${suffix}@test.com` })
      .select('id')
      .single();
    staffId = staff!.id;

    const { data: barber } = await supabase
      .from('barbers')
      .insert({ staff_user_id: staffId, branch_id: branchId, display_name: 'Queue Barber' })
      .select('id')
      .single();
    barberId = barber!.id;

    const activeStatuses = ['pending', 'confirmed', 'in_queue', 'in_service'];
    const inactiveStatuses = ['completed', 'cancelled'];

    const { data: activeAppointments } = await supabase
      .from('appointments')
      .insert(activeStatuses.map((status, index) => ({
        branch_id: branchId,
        barber_id: barberId,
        source: 'walk_in',
        status,
        queue_position: index + 1
      })))
      .select('id, status');

    const { data: inactiveAppointments } = await supabase
      .from('appointments')
      .insert(inactiveStatuses.map((status) => ({
        branch_id: branchId,
        barber_id: barberId,
        source: 'walk_in',
        status
      })))
      .select('id');

    activeAppointmentIds = (activeAppointments ?? []).map((appointment) => appointment.id);
    inactiveAppointmentIds = (inactiveAppointments ?? []).map((appointment) => appointment.id);

    const inService = activeAppointments?.find((appointment) => appointment.status === 'in_service');
    if (inService) {
      await redis.set(`appointment:eta:${inService.id}`, JSON.stringify({ eta_minutes: 7 }), 'EX', 60);
    }
  });

  afterAll(async () => {
    const appointmentIds = [...activeAppointmentIds, ...inactiveAppointmentIds];
    if (appointmentIds.length > 0) {
      await supabase.from('appointments').delete().in('id', appointmentIds);
      await Promise.all(appointmentIds.map((id) => redis.del(`appointment:eta:${id}`)));
    }

    if (barberId) await supabase.from('barbers').delete().eq('id', barberId);
    if (staffId) await supabase.from('staff_users').delete().eq('id', staffId);
    if (branchId) await supabase.from('branches').delete().eq('id', branchId);
  });

  it('mengembalikan semua status antrean aktif dan mengecualikan appointment selesai/batal', async () => {
    const snapshot = await QueueService.getBranchActiveQueueSnapshot(branchId);
    const statuses = snapshot.map((item) => item.status).sort();

    expect(statuses).toEqual(['confirmed', 'in_queue', 'in_service', 'pending']);
    expect(snapshot.some((item) => item.status === 'completed')).toBe(false);
    expect(snapshot.some((item) => item.status === 'cancelled')).toBe(false);

    const inService = snapshot.find((item) => item.status === 'in_service');
    expect(inService?.eta).toEqual({ eta_minutes: 7 });
  });
});
