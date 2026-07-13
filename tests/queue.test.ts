import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { testDb } from '../src/lib/test-db';
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

    const { data: branch } = await testDb
      .from('branches')
      .insert({ name: `Queue Branch ${suffix}` })
      .select('id')
      .single();
    branchId = branch!.id;

    const { data: staff } = await testDb
      .from('staff_users')
      .insert({ full_name: 'Queue Barber', email: `queue-${suffix}@test.com` })
      .select('id')
      .single();
    staffId = staff!.id;

    const { data: barber } = await testDb
      .from('barbers')
      .insert({ staff_user_id: staffId, branch_id: branchId, display_name: 'Queue Barber' })
      .select('id')
      .single();
    barberId = barber!.id;

    const activeStatuses = ['pending', 'confirmed', 'in_queue', 'in_service'];
    const inactiveStatuses = ['completed', 'cancelled'];

    const { data: activeAppointments } = await testDb
      .from('appointments')
      .insert(activeStatuses.map((status, index) => ({
        branch_id: branchId,
        barber_id: barberId,
        source: 'walk_in',
        status,
        queue_position: index + 1
      })))
      .select('id, status');

    const { data: inactiveAppointments } = await testDb
      .from('appointments')
      .insert(inactiveStatuses.map((status) => ({
        branch_id: branchId,
        barber_id: barberId,
        source: 'walk_in',
        status
      })))
      .select('id');

    activeAppointmentIds = (activeAppointments ?? []).map((appointment: any) => appointment.id);
    inactiveAppointmentIds = (inactiveAppointments ?? []).map((appointment: any) => appointment.id);

    const inService = activeAppointments?.find((appointment: any) => appointment.status === 'in_service');
    if (inService) {
      await redis.set(`appointment:eta:${inService.id}`, JSON.stringify({ eta_minutes: 7 }), 'EX', 60);
    }
  });

  afterAll(async () => {
    const appointmentIds = [...activeAppointmentIds, ...inactiveAppointmentIds];
    if (appointmentIds.length > 0) {
      await testDb.from('appointments').delete().in('id', appointmentIds);
      await Promise.all(appointmentIds.map((id) => redis.del(`appointment:eta:${id}`)));
    }

    if (barberId) await testDb.from('barbers').delete().eq('id', barberId);
    if (staffId) await testDb.from('staff_users').delete().eq('id', staffId);
    if (branchId) await testDb.from('branches').delete().eq('id', branchId);
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
