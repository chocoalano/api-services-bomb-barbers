import { Queue, Worker, Job } from 'bullmq';
import { redis } from './redis';
import { supabase } from './supabase';
import { AppointmentLifecycleService } from '../core/appointments/lifecycle.service';

export const APPOINTMENT_QUEUE = 'appointment_events';
export const AUDIT_QUEUE = 'audit_events';
export const ORDER_ACCEPTANCE_TIMEOUT = 'ORDER_ACCEPTANCE_TIMEOUT';
export const APPOINTMENT_NO_SHOW_TIMEOUT = 'APPOINTMENT_NO_SHOW_TIMEOUT';

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const ORDER_ACCEPTANCE_TIMEOUT_MINUTES = parsePositiveInteger(
  process.env.ORDER_ACCEPTANCE_TIMEOUT_MINUTES,
  60
);
export const APPOINTMENT_NO_SHOW_GRACE_MINUTES = parsePositiveInteger(
  process.env.APPOINTMENT_NO_SHOW_GRACE_MINUTES,
  15
);

// Inisialisasi Queue Appointments
export const appointmentQueue = new Queue(APPOINTMENT_QUEUE, {
  connection: redis as any
});

// Inisialisasi Queue Audit
export const auditQueue = new Queue(AUDIT_QUEUE, {
  connection: redis as any
});

type AppointmentTimeoutInput = {
  id: string;
  source: string;
  status: string;
  created_at?: string | null;
  scheduled_at?: string | null;
};

const delayUntil = (value: Date) => Math.max(value.getTime() - Date.now(), 0);

export const scheduleAppointmentTimeouts = async (appointment: AppointmentTimeoutInput) => {
  const jobs = [];

  if (appointment.source === 'online_booking' && appointment.status === 'pending') {
    const createdAt = new Date(appointment.created_at || Date.now());
    const deadlineAt = new Date(
      createdAt.getTime() + ORDER_ACCEPTANCE_TIMEOUT_MINUTES * 60_000
    );
    jobs.push(
      appointmentQueue.add(
        'order_acceptance_timeout',
        {
          type: ORDER_ACCEPTANCE_TIMEOUT,
          appointmentId: appointment.id,
          deadlineAt: deadlineAt.toISOString()
        },
        {
          delay: delayUntil(deadlineAt),
          jobId: `acceptance-${appointment.id}`,
          removeOnComplete: true
        }
      )
    );
  }

  if (appointment.scheduled_at) {
    const scheduledAt = new Date(appointment.scheduled_at);
    const deadlineAt = new Date(
      scheduledAt.getTime() + APPOINTMENT_NO_SHOW_GRACE_MINUTES * 60_000
    );
    jobs.push(
      appointmentQueue.add(
        'appointment_no_show_timeout',
        {
          type: APPOINTMENT_NO_SHOW_TIMEOUT,
          appointmentId: appointment.id,
          deadlineAt: deadlineAt.toISOString()
        },
        {
          delay: delayUntil(deadlineAt),
          jobId: `no-show-${appointment.id}`,
          removeOnComplete: true
        }
      )
    );
  }

  await Promise.all(jobs);
};

export const processAppointmentJob = async (job: Pick<Job, 'data'>) => {
  const { type, appointmentId, deadlineAt } = job.data;

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, status, scheduled_at')
    .eq('id', appointmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`[Appointment Worker] Gagal membaca appointment: ${error.message}`);
  }
  if (!appointment) return;

  if (deadlineAt && new Date(deadlineAt).getTime() > Date.now()) {
    return;
  }

  if (type === ORDER_ACCEPTANCE_TIMEOUT || type === 'AUTO_CANCEL_NO_SHOW') {
    // Job legacy AUTO_CANCEL_NO_SHOW diperlakukan sebagai acceptance timeout.
    // Appointment yang sudah confirmed tidak boleh dibatalkan oleh timeout ini.
    if (appointment.status !== 'pending') return;

    await AppointmentLifecycleService.transition(appointmentId, 'cancelled', {
      actor: { type: 'system', id: null, role: 'system' },
      event_type: ORDER_ACCEPTANCE_TIMEOUT,
      reason: 'Order dibatalkan karena tidak diterima sampai batas waktu'
    });
    return;
  }

  if (type === APPOINTMENT_NO_SHOW_TIMEOUT) {
    if (!['confirmed', 'in_queue'].includes(appointment.status)) return;

    await AppointmentLifecycleService.transition(appointmentId, 'no_show', {
      actor: { type: 'system', id: null, role: 'system' },
      event_type: APPOINTMENT_NO_SHOW_TIMEOUT,
      reason: 'Customer tidak hadir sampai batas waktu setelah jadwal'
    });
  }
};

// Inisialisasi Worker Audit
export let auditWorker: Worker | null = null;
export let appointmentWorker: Worker | null = null;

export const startQueueWorkers = () => {
  if (auditWorker || appointmentWorker) return;

  auditWorker = new Worker(AUDIT_QUEUE, async (job: Job) => {
    const { actor_type, actor_id, action, entity_type, entity_id, before, after, branch_id } = job.data;

    const { error } = await supabase.from('audit_logs').insert({
      actor_type,
      actor_id,
      action,
      entity_type,
      entity_id,
      before: before ?? null,
      after: after ?? null,
      branch_id: branch_id ?? null
    });

    if (error) {
      throw new Error(`[Audit Worker] Gagal mencatat log: ${error.message}`);
    }
  }, { connection: redis as any });

  auditWorker.on('failed', (job, err) => {
    console.error(`[BullMQ Audit] Job ${job?.id} failed with ${err.message}`);
  });

  appointmentWorker = new Worker(
    APPOINTMENT_QUEUE,
    processAppointmentJob,
    { connection: redis as any }
  );

  appointmentWorker.on('completed', job => {
    console.log(`[BullMQ] Job ${job.id} completed!`);
  });
  appointmentWorker.on('failed', (job, err) => {
    console.error(`[BullMQ] Job ${job?.id} failed with ${err.message}`);
  });
};

export const stopQueueInfrastructure = async () => {
  await Promise.all([
    auditWorker?.close(),
    appointmentWorker?.close(),
    auditQueue.close(),
    appointmentQueue.close()
  ]);
  auditWorker = null;
  appointmentWorker = null;
};

const shouldRunWorkersInProcess =
  process.env.RUN_WORKERS_IN_PROCESS === 'true' ||
  process.env.NODE_ENV !== 'production';

if (shouldRunWorkersInProcess) {
  startQueueWorkers();
}
