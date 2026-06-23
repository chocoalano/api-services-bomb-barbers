import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AppointmentLifecycleService } from '../src/core/appointments/lifecycle.service';
import { supabase } from '../src/lib/supabase';

let customerId = '';
let barberId = '';
let barberStaffId = '';
let branchId = '';
let otherBranchId = '';
let serviceId = '';

const appointmentIds: string[] = [];
const timeOffIds: string[] = [];
const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const jakartaDateAt = (daysFromNow: number, hour: number) => {
  const reference = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(reference);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(
    `${values.year}-${values.month}-${values.day}T${String(hour).padStart(2, '0')}:00:00+07:00`
  ).toISOString();
};

const createAtomic = async (input: {
  scheduledAt: string;
  idempotencyKey: string;
  targetBranchId?: string;
  targetBarberId?: string | null;
}) => {
  const response = await (supabase as any).rpc('create_appointment_atomic', {
    p_branch_id: input.targetBranchId || branchId,
    p_barber_id: input.targetBarberId === undefined ? barberId : input.targetBarberId,
    p_customer_id: customerId,
    p_service_ids: [serviceId],
    p_scheduled_at: input.scheduledAt,
    p_source: 'online_booking',
    p_idempotency_key: input.idempotencyKey,
    p_actor_type: 'customer',
    p_actor_id: customerId,
    p_customer_media_urls: [],
    p_fulfillment_type: 'in_store',
    p_service_address: null,
    p_destination_latitude: null,
    p_destination_longitude: null,
    p_location_notes: null,
    p_travel_buffer_min: 0
  });

  if (response.data?.id) appointmentIds.push(response.data.id);
  return response;
};

beforeAll(async () => {
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('email', 'fajar.customer@example.com')
    .single();
  customerId = customer!.id;

  const { data: staff } = await supabase
    .from('staff_users')
    .select('id')
    .eq('email', 'budi@bombbarbers.com')
    .single();
  barberStaffId = staff!.id;

  const { data: barber } = await supabase
    .from('barbers')
    .select('id, branch_id')
    .eq('staff_user_id', barberStaffId)
    .single();
  barberId = barber!.id;
  branchId = barber!.branch_id;

  const { data: otherBranch } = await supabase
    .from('branches')
    .select('id')
    .neq('id', branchId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .single();
  otherBranchId = otherBranch!.id;

  const { data: service } = await supabase
    .from('services')
    .select('id')
    .eq('name', 'Premium Haircut')
    .eq('is_active', true)
    .is('deleted_at', null)
    .single();
  serviceId = service!.id;
});

afterAll(async () => {
  const uniqueAppointmentIds = Array.from(new Set(appointmentIds));
  if (uniqueAppointmentIds.length > 0) {
    await supabase
      .from('appointment_events')
      .delete()
      .in('appointment_id', uniqueAppointmentIds);
    await supabase
      .from('appointment_services')
      .delete()
      .in('appointment_id', uniqueAppointmentIds);
    await supabase
      .from('appointments')
      .delete()
      .in('id', uniqueAppointmentIds);
  }
  if (timeOffIds.length > 0) {
    await supabase.from('barber_time_off').delete().in('id', timeOffIds);
  }
});

describe('Tahap 2 - booking atomik', () => {
  it('menolak dua booking bersamaan untuk barber dan slot yang sama', async () => {
    const scheduledAt = jakartaDateAt(20, 14);
    const [first, second] = await Promise.all([
      createAtomic({
        scheduledAt,
        idempotencyKey: `stage2-overlap-a-${uniqueSuffix}`
      }),
      createAtomic({
        scheduledAt,
        idempotencyKey: `stage2-overlap-b-${uniqueSuffix}`
      })
    ]);

    const successful = [first, second].filter((result) => result.data && !result.error);
    const rejected = [first, second].filter((result) => result.error);

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error.code).toBe('23P01');
  }, 15_000);

  it('mengembalikan appointment yang sama ketika Idempotency-Key di-retry', async () => {
    const scheduledAt = jakartaDateAt(21, 14);
    const idempotencyKey = `stage2-retry-${uniqueSuffix}`;

    const first = await createAtomic({ scheduledAt, idempotencyKey });
    const second = await createAtomic({ scheduledAt, idempotencyKey });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data.id).toBe(first.data.id);

    const { count } = await supabase
      .from('appointment_services')
      .select('id', { count: 'exact', head: true })
      .eq('appointment_id', first.data.id);
    expect(count).toBe(1);
  });

  it('menolak barber dari cabang lain', async () => {
    const result = await createAtomic({
      scheduledAt: jakartaDateAt(22, 14),
      idempotencyKey: `stage2-cross-branch-${uniqueSuffix}`,
      targetBranchId: otherBranchId
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('tidak berasal dari cabang');
  });

  it('menolak booking masa lalu dan cabang nonaktif', async () => {
    const past = await createAtomic({
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      idempotencyKey: `stage2-past-${uniqueSuffix}`
    });
    expect(past.data).toBeNull();
    expect(past.error?.message).toContain('sudah lewat');

    const { data: inactiveBranch, error } = await supabase
      .from('branches')
      .insert({
        name: `Stage 2 Inactive ${uniqueSuffix}`,
        is_active: false
      })
      .select('id')
      .single();
    if (error) throw error;

    const inactive = await createAtomic({
      scheduledAt: jakartaDateAt(23, 14),
      idempotencyKey: `stage2-inactive-${uniqueSuffix}`,
      targetBranchId: inactiveBranch!.id,
      targetBarberId: null
    });

    expect(inactive.data).toBeNull();
    expect(inactive.error?.message).toContain('tidak aktif');
    await supabase.from('branches').delete().eq('id', inactiveBranch!.id);
  });

  it('menolak booking saat barber memiliki time-off aktif', async () => {
    const scheduledAt = jakartaDateAt(24, 14);
    const endAt = new Date(new Date(scheduledAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
    const { data: timeOff, error } = await supabase
      .from('barber_time_off')
      .insert({
        barber_id: barberId,
        start_at: scheduledAt,
        end_at: endAt,
        status: 'approved',
        reason: 'Stage 2 test'
      })
      .select('id')
      .single();
    if (error) throw error;
    timeOffIds.push(timeOff!.id);

    const result = await createAtomic({
      scheduledAt,
      idempotencyKey: `stage2-timeoff-${uniqueSuffix}`
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('tidak tersedia');
  });
});

describe('Tahap 2 - lifecycle beraktor', () => {
  it('mencatat actor dan reason pada setiap transisi', async () => {
    const created = await createAtomic({
      scheduledAt: jakartaDateAt(25, 14),
      idempotencyKey: `stage2-event-${uniqueSuffix}`
    });
    if (created.error) throw created.error;

    await AppointmentLifecycleService.transition(created.data.id, 'confirmed', {
      actor: { type: 'staff', id: barberStaffId, role: 'barber' },
      reason: 'Barber menerima order pada pengujian Tahap 2'
    });

    const { data: event, error } = await supabase
      .from('appointment_events')
      .select('actor_type, actor_id, actor_role, reason, from_status, to_status')
      .eq('appointment_id', created.data.id)
      .eq('event_type', 'STATUS_TRANSITION')
      .single();
    if (error) throw error;

    expect(event.actor_type).toBe('staff');
    expect(event.actor_id).toBe(barberStaffId);
    expect(event.actor_role).toBe('barber');
    expect(event.reason).toContain('Tahap 2');
    expect(event.from_status).toBe('pending');
    expect(event.to_status).toBe('confirmed');
  });

  it('menolak customer yang mencoba mengonfirmasi appointment', async () => {
    const created = await createAtomic({
      scheduledAt: jakartaDateAt(26, 14),
      idempotencyKey: `stage2-customer-confirm-${uniqueSuffix}`
    });
    if (created.error) throw created.error;

    await expect(
      AppointmentLifecycleService.transition(created.data.id, 'confirmed', {
        actor: { type: 'customer', id: customerId, role: 'customer' },
        reason: 'Customer mencoba mengonfirmasi sendiri'
      })
    ).rejects.toThrow('Customer hanya dapat membatalkan');
  });
});
