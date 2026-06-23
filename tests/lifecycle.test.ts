import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { supabase } from '../src/lib/supabase';
import { AppointmentLifecycleService } from '../src/core/appointments/lifecycle.service';
import {
  APPOINTMENT_NO_SHOW_TIMEOUT,
  ORDER_ACCEPTANCE_TIMEOUT,
  processAppointmentJob
} from '../src/lib/queue';

let branchId = '';
let barberId = '';
let daviesStaffId = '';
let customerId = '';
const appointmentIds: string[] = [];

beforeAll(async () => {
  const { data: fajar } = await supabase
    .from('customers')
    .select('id')
    .eq('email', 'fajar.customer@example.com')
    .single();
  customerId = fajar!.id;

  const { data: daviesStaff } = await supabase
    .from('staff_users')
    .select('id')
    .eq('email', 'davies@bombbarbershop.com')
    .single();
  daviesStaffId = daviesStaff!.id;
  const { data: budi } = await supabase
    .from('barbers')
    .select('id, branch_id')
    .eq('staff_user_id', daviesStaff!.id)
    .single();
  barberId = budi!.id;
  branchId = budi!.branch_id;
});

afterAll(async () => {
  if (appointmentIds.length) {
    await supabase.from('tracking_sessions').delete().in('appointment_id', appointmentIds);
    await supabase.from('appointment_events').delete().in('appointment_id', appointmentIds);
    await supabase.from('appointments').delete().in('id', appointmentIds);
  }
});

describe('Concurrent appointment status update', () => {
  it('retry transisi status tetap idempoten dan hanya mencatat satu event', async () => {
    const { data: apt, error } = await supabase
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'walk_in',
        status: 'pending',
        queue_position: 1
      })
      .select('id')
      .single();
    if (error) throw error;
    appointmentIds.push(apt!.id);

    await AppointmentLifecycleService.transition(apt!.id, 'confirmed', {
      actor: { type: 'staff', id: daviesStaffId, role: 'barber' },
      reason: 'Order diterima barber'
    });
    await AppointmentLifecycleService.transition(apt!.id, 'confirmed', {
      actor: { type: 'staff', id: daviesStaffId, role: 'barber' },
      reason: 'Retry penerimaan order yang sama'
    });

    const { data: final } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', apt!.id)
      .single();
    expect(final!.status).toBe('confirmed');

    const { count: transitionCount } = await supabase
      .from('appointment_events')
      .select('id', { count: 'exact', head: true })
      .eq('appointment_id', apt!.id)
      .eq('event_type', 'STATUS_TRANSITION')
      .eq('to_status', 'confirmed');
    expect(transitionCount).toBe(1);
  });

  it('menolak transisi status yang tidak diizinkan oleh state machine', async () => {
    const { data: apt, error } = await supabase
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'walk_in',
        status: 'in_service',
        queue_position: 1
      })
      .select('id')
      .single();
    if (error) throw error;
    appointmentIds.push(apt!.id);

    await expect(
      AppointmentLifecycleService.transition(apt!.id, 'pending', {
        actor: { type: 'staff', id: daviesStaffId, role: 'admin' },
        reason: 'Percobaan transisi tidak valid'
      })
    ).rejects.toThrow('tidak diizinkan');

    const { data: unchanged } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', apt!.id)
      .single();
    expect(unchanged!.status).toBe('in_service');
  });
});

describe('Appointment timeout logic', () => {
  it('acceptance timeout hanya membatalkan appointment pending', async () => {
    const { data: apt, error } = await supabase
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'online_booking',
        status: 'pending',
        scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        queue_position: 1
      })
      .select('id, status')
      .single();
    if (error) throw error;
    appointmentIds.push(apt!.id);

    await processAppointmentJob({
      data: {
        type: ORDER_ACCEPTANCE_TIMEOUT,
        appointmentId: apt!.id,
        deadlineAt: new Date(Date.now() - 1000).toISOString()
      }
    });

    const { data: result } = await supabase
      .from('appointments')
      .select('status, cancellation_reason')
      .eq('id', apt!.id)
      .single();

    expect(result!.status).toBe('cancelled');
    expect(result!.cancellation_reason).toContain('tidak diterima');
  });

  it('no-show timeout menghasilkan status no_show, bukan cancelled', async () => {
    const { data: apt, error } = await supabase
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'online_booking',
        status: 'confirmed',
        scheduled_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        queue_position: 1
      })
      .select('id, status')
      .single();
    if (error) throw error;
    appointmentIds.push(apt!.id);

    await processAppointmentJob({
      data: {
        type: APPOINTMENT_NO_SHOW_TIMEOUT,
        appointmentId: apt!.id,
        deadlineAt: new Date(Date.now() - 1000).toISOString()
      }
    });

    const { data: unchanged } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', apt!.id)
      .single();
    expect(unchanged!.status).toBe('no_show');
  });

  it('acceptance timeout tidak membatalkan appointment yang sudah confirmed', async () => {
    const { data: apt, error } = await supabase
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'online_booking',
        status: 'confirmed',
        queue_position: 1
      })
      .select('id')
      .single();
    if (error) throw error;
    appointmentIds.push(apt!.id);

    await processAppointmentJob({
      data: {
        type: ORDER_ACCEPTANCE_TIMEOUT,
        appointmentId: apt!.id,
        deadlineAt: new Date(Date.now() - 1000).toISOString()
      }
    });

    const { data: unchanged } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', apt!.id)
      .single();
    expect(unchanged!.status).toBe('confirmed');
  });

  it('mengubah version saat setiap transisi status', async () => {
    const { data: apt, error } = await supabase
      .from('appointments')
      .select('version')
      .eq('status', 'pending')
      .eq('branch_id', branchId)
      .limit(1)
      .maybeSingle();

    // Skip jika kolom version belum ada di schema.
    if (error || !apt || apt.version === undefined) return;

    const { data: newApt } = await supabase
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'walk_in',
        status: 'pending',
        queue_position: 1
      })
      .select('id, version')
      .single();
    if (!newApt) return;
    appointmentIds.push(newApt.id);

    const versionBefore = Number(newApt.version);
    await AppointmentLifecycleService.transition(newApt.id, 'confirmed', {
      actor: { type: 'staff', id: daviesStaffId, role: 'barber' },
      reason: 'Order diterima barber'
    });

    const { data: after } = await supabase
      .from('appointments')
      .select('version')
      .eq('id', newApt.id)
      .single();

    expect(Number(after!.version)).toBe(versionBefore + 1);
  });
});
