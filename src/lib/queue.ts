import { Queue, Worker, Job } from 'bullmq';
import { redis } from './redis';
import { db } from './db';
import { camelKeys } from '../db/helpers';
import { staffUserRoles, appointments, payments, auditLogs } from '../db/schema';
import { adminNotificationSettings } from '../db/schema-extra';
import { eq, inArray } from 'drizzle-orm';
import { logger } from './logger';
import { io } from './socket';
import { AppointmentLifecycleService } from '../core/appointments/lifecycle.service';
import { CommissionService } from '../core/commissions/service';
import { PaymentService } from '../core/payments/service';
import { escalatePaidPendingOrder } from '../core/appointments/paid-order-escalation.service';
import { refundAppointmentToWallet } from '../core/appointments/refund.service';

export const APPOINTMENT_QUEUE = 'appointment_events';
export const AUDIT_QUEUE = 'audit_events';
export const ORDER_ACCEPTANCE_TIMEOUT = 'ORDER_ACCEPTANCE_TIMEOUT';
export const APPOINTMENT_NO_SHOW_TIMEOUT = 'APPOINTMENT_NO_SHOW_TIMEOUT';
// [REVISI A11] Order otomatis "done" setelah kepster selesai + masa tenggang.
export const APPOINTMENT_AUTO_COMPLETE_TIMEOUT = 'APPOINTMENT_AUTO_COMPLETE_TIMEOUT';
// [REVISI C3] Pengingat appointment (dikirim 60 menit sebelum jadwal).
export const APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER';
// Pencatatan komisi otomatis saat order selesai & lunas. Sebelumnya komisi HANYA
// tercatat bila admin menembak endpoint manual, sehingga pendapatan barber tidak
// pernah masuk pembukuan.
export const COMMISSION_CALCULATE = 'COMMISSION_CALCULATE';
// Pengembalian dana ke dompet customer untuk order yang gagal karena penyedia
// (barber menolak / no-show / dibatalkan admin). Dijadikan job agar kegagalan
// di-retry, bukan ditelan log seperti sebelumnya.
export const REFUND_APPOINTMENT = 'REFUND_APPOINTMENT';
// [B1] Eskalasi order LUNAS yang tidak kunjung diterima barber: dialihkan ke
// barber lain, dan sebagai jaring terakhir dibatalkan + dikembalikan dananya.
export const PAID_ORDER_ESCALATION = 'PAID_ORDER_ESCALATION';

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Batas waktu pesanan online yang BELUM dibayar sebelum dibatalkan otomatis.
// Order lunas TIDAK terpengaruh (lanjut ke antrean). Default 60 menit (1 jam).
//
// Catatan: konstanta `ORDER_ACCEPTANCE_TIMEOUT_MINUTES` yang dulu ada di sini
// sudah dihapus — namanya mirip, nilainya juga 60, tetapi tidak pernah dipakai
// di mana pun sehingga berisiko diubah orang yang mengira itu batas bayar.
export const UNPAID_ORDER_EXPIRY_MINUTES = parsePositiveInteger(
  process.env.UNPAID_ORDER_EXPIRY_MINUTES,
  60
);
// [B1] Tenggat pengalihan dihitung MUNDUR dari jam jadwal, supaya order masih
// sempat dikerjakan bila berhasil dipindahkan ke barber lain.
export const PAID_ORDER_ESCALATION_STAGES_MINUTES_BEFORE = [60, 20];
export const APPOINTMENT_NO_SHOW_GRACE_MINUTES = parsePositiveInteger(
  process.env.APPOINTMENT_NO_SHOW_GRACE_MINUTES,
  15
);
// [REVISI A11] Masa tenggang auto-complete setelah perkiraan layanan selesai.
export const APPOINTMENT_AUTO_COMPLETE_GRACE_MINUTES = parsePositiveInteger(
  process.env.APPOINTMENT_AUTO_COMPLETE_GRACE_MINUTES,
  30
);
// [REVISI C3] Menit sebelum jadwal untuk mengirim pengingat.
export const APPOINTMENT_REMINDER_LEAD_MINUTES = parsePositiveInteger(
  process.env.APPOINTMENT_REMINDER_LEAD_MINUTES,
  60
);
// [REVISI C3] Horizon maksimum penjadwalan pengingat. Appointment yang jadwalnya
// lebih jauh dari batas ini tidak dijadwalkan pengingat (hemat job & sesuai
// kebijakan pengingat maksimal 3 minggu ke depan).
export const MAX_REMINDER_HORIZON_DAYS = parsePositiveInteger(
  process.env.MAX_REMINDER_HORIZON_DAYS,
  21
);

// Opsi default job: retry dengan backoff eksponensial (job gagal transien tidak
// mati sekali coba), dan trimming otomatis agar job selesai/gagal tidak menumpuk
// di Redis tanpa batas. (HB3)
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 }
};

// Inisialisasi Queue Appointments
export const appointmentQueue = new Queue(APPOINTMENT_QUEUE, {
  connection: redis as any,
  defaultJobOptions
});

// Inisialisasi Queue Audit
export const auditQueue = new Queue(AUDIT_QUEUE, {
  connection: redis as any,
  defaultJobOptions
});

type AppointmentTimeoutInput = {
  id: string;
  source: string;
  status: string;
  created_at?: string | null;
  scheduled_at?: string | null;
};

const delayUntil = (value: Date) => Math.max(value.getTime() - Date.now(), 0);

/**
 * Jadwalkan pencatatan komisi untuk sebuah order. Dipanggil dari DUA pemicu:
 * (1) order bertransisi ke `completed`, dan (2) pembayaran menjadi `paid`
 * sementara order sudah `completed` — tanpa pemicu kedua, order yang selesai
 * sebelum dana settle tidak akan pernah berkomisi.
 *
 * Aman dipanggil berkali-kali: `jobId` deterministik meredam duplikasi di level
 * antrean, dan unique constraint `commission_entries_appointment_id_unique`
 * menjaga di level data.
 */
export const enqueueCommissionCalculation = async (appointmentId: string) => {
  if (!appointmentId) return;
  try {
    await appointmentQueue.add(
      'commission_calculate',
      { type: COMMISSION_CALCULATE, appointmentId },
      { jobId: `commission-${appointmentId}`, removeOnComplete: true }
    );
  } catch (err: any) {
    // Non-fatal: penyelesaian order tidak boleh gagal hanya karena antrean.
    // Sweeper/percobaan berikutnya masih bisa menutupinya.
    logger.error({ err, appointmentId }, '[Commission] Gagal menjadwalkan perhitungan komisi');
  }
};

/**
 * Jadwalkan pengembalian dana ke dompet customer. Dipakai jalur kesalahan
 * penyedia (barber menolak, no-show, pembatalan admin).
 */
export const enqueueAppointmentRefund = async (params: {
  appointmentId: string;
  reason: string;
  processedBy: string | null;
}) => {
  if (!params.appointmentId) return;
  try {
    await appointmentQueue.add(
      'refund_appointment',
      { type: REFUND_APPOINTMENT, ...params },
      { jobId: `refund-${params.appointmentId}`, removeOnComplete: true }
    );
  } catch (err: any) {
    logger.error({ err, appointmentId: params.appointmentId }, '[Refund] Gagal menjadwalkan refund');
  }
};

/**
 * Jalankan pengembalian dana kesalahan penyedia dengan jaring pengaman:
 * percobaan pertama dilakukan langsung agar respons API dapat melaporkan
 * hasilnya, dan bila gagal dilempar ke antrean untuk di-retry.
 *
 * TIDAK PERNAH melempar — pembatalan order tidak boleh gagal gara-gara refund,
 * tetapi kegagalannya juga tidak boleh hilang seperti perilaku lama.
 *
 * Diletakkan di sini (bukan di refund.service.ts) supaya tidak ada impor
 * melingkar antara modul antrean dan modul refund.
 */
export const settleProviderFaultRefund = async (
  appointmentId: string,
  opts: { reason: string; processedBy: string | null }
) => {
  try {
    return await refundAppointmentToWallet(appointmentId, opts);
  } catch (err: any) {
    logger.error(
      { err, appointmentId },
      '[Refund] Percobaan langsung gagal, dijadwalkan ulang lewat antrean'
    );
    await enqueueAppointmentRefund({ appointmentId, ...opts });
    return { credited: false, amount: 0, skippedReason: null as null };
  }
};

/**
 * [B1] Jadwalkan eskalasi untuk order yang baru saja lunas. Tiga tahap:
 * dua kali percobaan pengalihan sebelum jadwal, lalu satu jaring terakhir
 * sesudah jadwal + masa tenggang (batalkan + refund).
 *
 * Tenggat yang sudah terlewat dijalankan segera (delay 0) — order mendadak
 * yang dibayar dekat jadwalnya tetap dapat kesempatan dialihkan (keputusan F1).
 */
export const schedulePaidOrderEscalation = async (
  appointmentId: string,
  scheduledAtIso: string | null | undefined
) => {
  if (!appointmentId || !scheduledAtIso) return;
  const scheduledAt = new Date(scheduledAtIso);
  if (Number.isNaN(scheduledAt.getTime())) return;

  const stages = [
    ...PAID_ORDER_ESCALATION_STAGES_MINUTES_BEFORE.map((minutesBefore, index) => ({
      stage: index + 1,
      finalStage: false,
      at: new Date(scheduledAt.getTime() - minutesBefore * 60_000)
    })),
    {
      stage: PAID_ORDER_ESCALATION_STAGES_MINUTES_BEFORE.length + 1,
      finalStage: true,
      at: new Date(scheduledAt.getTime() + APPOINTMENT_NO_SHOW_GRACE_MINUTES * 60_000)
    }
  ];

  try {
    await Promise.all(
      stages.map((s) =>
        appointmentQueue.add(
          'paid_order_escalation',
          {
            type: PAID_ORDER_ESCALATION,
            appointmentId,
            finalStage: s.finalStage,
            deadlineAt: s.at.toISOString()
          },
          {
            delay: delayUntil(s.at),
            jobId: `escalation-${appointmentId}-${s.stage}`,
            removeOnComplete: true
          }
        )
      )
    );
  } catch (err: any) {
    logger.error({ err, appointmentId }, '[Escalation] Gagal menjadwalkan eskalasi order lunas');
  }
};

export const scheduleAppointmentTimeouts = async (appointment: AppointmentTimeoutInput) => {
  const jobs = [];

  if (appointment.source === 'online_booking' && appointment.status === 'pending') {
    const createdAt = new Date(appointment.created_at || Date.now());
    // Batalkan otomatis bila belum dibayar dalam UNPAID_ORDER_EXPIRY_MINUTES
    // (default 1 jam) sejak dibuat.
    const deadlineAt = new Date(
      createdAt.getTime() + UNPAID_ORDER_EXPIRY_MINUTES * 60_000
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

  // No-show hanya relevan untuk online booking terjadwal ke depan: customer mungkin
  // tidak hadir pada waktu janji. Walk-in (customer sudah berada di tempat & menunggu
  // di antrean) TIDAK boleh di-auto no_show hanya karena antre >15 menit. (H7)
  if (appointment.scheduled_at && appointment.source === 'online_booking') {
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

// [REVISI A11] Jadwalkan auto-complete saat kepster memulai layanan. Bila kepster
// lupa menandai selesai, order otomatis di-`completed` pada `autoCompleteAt`.
export const scheduleAutoComplete = async (appointmentId: string, autoCompleteAtIso: string) => {
  const deadlineAt = new Date(autoCompleteAtIso);
  if (Number.isNaN(deadlineAt.getTime())) return;
  await appointmentQueue.add(
    'appointment_auto_complete',
    {
      type: APPOINTMENT_AUTO_COMPLETE_TIMEOUT,
      appointmentId,
      deadlineAt: deadlineAt.toISOString()
    },
    {
      delay: delayUntil(deadlineAt),
      jobId: `auto-complete-${appointmentId}`,
      removeOnComplete: true
    }
  );
};

// [REVISI C3] Jadwalkan pengingat 60 menit sebelum jadwal untuk online booking
// yang jadwalnya di masa depan DAN dalam horizon maksimum (MAX_REMINDER_HORIZON_DAYS).
// No-op bila bukan online booking, tanpa scheduled_at, sudah lewat, atau di luar horizon.
// Idempoten via jobId `reminder-{id}`.
export const scheduleAppointmentReminder = async (appointment: AppointmentTimeoutInput) => {
  if (appointment.source !== 'online_booking' || !appointment.scheduled_at) return;

  const scheduledAt = new Date(appointment.scheduled_at);
  if (Number.isNaN(scheduledAt.getTime())) return;

  const now = Date.now();
  if (scheduledAt.getTime() <= now) return; // jadwal sudah lewat

  // Lewati bila jadwal lebih jauh dari horizon maksimum.
  const horizonMs = MAX_REMINDER_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() - now > horizonMs) return;

  const reminderAt = new Date(
    scheduledAt.getTime() - APPOINTMENT_REMINDER_LEAD_MINUTES * 60_000
  );
  // Bila waktu pengingat sudah lewat (jadwal < lead time dari sekarang), lewati.
  if (reminderAt.getTime() <= now) return;

  await appointmentQueue.add(
    'appointment_reminder',
    {
      type: APPOINTMENT_REMINDER,
      appointmentId: appointment.id,
      deadlineAt: reminderAt.toISOString()
    },
    {
      delay: delayUntil(reminderAt),
      jobId: `reminder-${appointment.id}`,
      removeOnComplete: true
    }
  );
};

// [REVISI C3] Pengingat mengikuti toggle admin_notification_settings.appointment_reminder
// pada level cabang. Toggle disimpan per staff (admin); pengingat dianggap AKTIF bila
// minimal satu admin cabang menghendakinya (baris default/absen = true).
const isBranchReminderEnabled = async (branchId: string | null): Promise<boolean> => {
  if (!branchId) return true;

  const roles = await db
    .select({ staff_user_id: staffUserRoles.staffUserId })
    .from(staffUserRoles)
    .where(eq(staffUserRoles.branchId, branchId));

  const staffIds = [...new Set(roles.map((r) => r.staff_user_id).filter(Boolean))];
  if (staffIds.length === 0) return true;

  const settings = await db
    .select({ appointment_reminder: adminNotificationSettings.appointmentReminder })
    .from(adminNotificationSettings)
    .where(inArray(adminNotificationSettings.staffUserId, staffIds));

  const explicitlyDisabled = settings.filter(
    (s) => s.appointment_reminder === false
  ).length;
  // Aktif bila ada admin yang menghendaki (eksplisit true atau tanpa baris = default true).
  return explicitlyDisabled < staffIds.length;
};

export const processAppointmentJob = async (job: Pick<Job, 'data'>) => {
  const { type, appointmentId, deadlineAt } = job.data;

  const [appointment] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      scheduled_at: appointments.scheduledAt,
      customer_id: appointments.customerId,
      branch_id: appointments.branchId
    })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (!appointment) return;

  if (deadlineAt && new Date(deadlineAt).getTime() > Date.now()) {
    return;
  }

  // Pencatatan komisi otomatis. Duplikat diperlakukan sebagai sukses agar retry
  // tidak menumpuk error; kegagalan lain dilempar supaya BullMQ me-retry.
  if (type === COMMISSION_CALCULATE) {
    if (appointment.status !== 'completed') return;
    try {
      await CommissionService.calculateCommission(appointmentId);
      logger.info({ appointmentId }, '[Commission] Komisi tercatat otomatis');
    } catch (err: any) {
      if (err?.code === 'COMMISSION_ALREADY_RECORDED') return;
      // Order selesai tapi belum lunas: biarkan pemicu pembayaran yang menangani,
      // jangan habiskan retry untuk kondisi yang memang belum saatnya.
      if (/belum lunas dibayar/i.test(err?.message ?? '')) return;
      logger.error({ err, appointmentId }, '[Commission] Gagal mencatat komisi');
      throw err;
    }
    return;
  }

  // Pengembalian dana untuk order yang gagal karena penyedia.
  if (type === REFUND_APPOINTMENT) {
    const outcome = await refundAppointmentToWallet(appointmentId, {
      reason: job.data.reason ?? 'Pengembalian dana otomatis',
      processedBy: job.data.processedBy ?? null
    });
    if (!outcome.credited) {
      logger.info(
        { appointmentId, reason: outcome.skippedReason },
        '[Refund] Tidak ada dana yang perlu dikembalikan'
      );
    }
    return;
  }

  // [B1] Order lunas yang tidak kunjung diterima barber.
  if (type === PAID_ORDER_ESCALATION) {
    const outcome = await escalatePaidPendingOrder(appointmentId, {
      finalStage: job.data.finalStage === true
    });

    if (outcome.action !== 'exhausted') return;

    // Tidak ada lagi yang bisa dialihkan → kesalahan penyedia: batalkan dan
    // kembalikan dananya. Customer tidak boleh dibiarkan menunggu selamanya.
    if (appointment.status !== 'pending') return;
    await AppointmentLifecycleService.transition(appointmentId, 'cancelled', {
      actor: { type: 'system', id: null, role: 'system' },
      reason: 'Dibatalkan otomatis: tidak ada barber yang menerima pesanan berbayar ini'
    });
    await settleProviderFaultRefund(appointmentId, {
      reason: 'Refund order berbayar yang tidak diterima barber',
      processedBy: null
    });
    logger.warn(
      { appointmentId, reason: outcome.reason },
      '[Escalation] Order lunas dibatalkan & dana dikembalikan'
    );
    return;
  }

  if (type === ORDER_ACCEPTANCE_TIMEOUT || type === 'AUTO_CANCEL_NO_SHOW') {
    // Job legacy AUTO_CANCEL_NO_SHOW diperlakukan sebagai acceptance timeout.
    // Appointment yang sudah confirmed tidak boleh dibatalkan oleh timeout ini.
    if (appointment.status !== 'pending') return;

    // Order yang SUDAH dibayar tidak boleh dibatalkan — order lunas harus tetap
    // ada dan lanjut menunggu antrean. Hanya order yang belum lunas yang gugur
    // setelah batas UNPAID_ORDER_EXPIRY_MINUTES (default 1 jam).
    const pays = await db
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.appointmentId, appointmentId));
    const isPaid = pays.some((p) => p.status === 'paid');
    if (isPaid) return;

    // [A4] Rekonsiliasi terakhir ke gateway: pembayaran mungkin sudah lunas
    // tetapi webhook-nya belum sampai. Bila ternyata lunas, order TIDAK
    // dibatalkan.
    if (await PaymentService.reconcilePendingPaymentFromGateway(appointmentId)) return;

    await AppointmentLifecycleService.transition(appointmentId, 'cancelled', {
      actor: { type: 'system', id: null, role: 'system' },
      event_type: ORDER_ACCEPTANCE_TIMEOUT,
      reason: `Order dibatalkan otomatis karena belum dibayar dalam ${UNPAID_ORDER_EXPIRY_MINUTES} menit`
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

    // Order lunas yang berakhir no-show tetap dikembalikan dananya — konsisten
    // dengan jalur no-show yang ditandai barber.
    await settleProviderFaultRefund(appointmentId, {
      reason: 'Refund order no-show otomatis',
      processedBy: null
    });
    return;
  }

  // [REVISI C3] Pengingat appointment: cek ulang toggle cabang & status pra-layanan.
  // Idempoten; bila toggle mati atau order sudah lewat pra-layanan → no-op.
  if (type === APPOINTMENT_REMINDER) {
    if (!['pending', 'confirmed', 'in_queue'].includes(appointment.status)) return;

    const enabled = await isBranchReminderEnabled(appointment.branch_id);
    if (!enabled) return;

    if (appointment.customer_id) {
      io.to(`customer:${appointment.customer_id}`).emit('appointment:reminder', {
        appointment_id: appointment.id,
        scheduled_at: appointment.scheduled_at
      });
    }
    return;
  }

  // [REVISI A11] Auto-complete: hanya bila masih in_service (kepster belum menandai
  // selesai). Order yang sudah completed/dibatalkan diabaikan (idempoten).
  if (type === APPOINTMENT_AUTO_COMPLETE_TIMEOUT) {
    if (appointment.status !== 'in_service') return;

    await AppointmentLifecycleService.transition(appointmentId, 'completed', {
      actor: { type: 'system', id: null, role: 'system' },
      event_type: APPOINTMENT_AUTO_COMPLETE_TIMEOUT,
      reason: 'Order otomatis diselesaikan setelah layanan selesai + masa tenggang'
    });
    // Jalur ini memanggil lifecycle langsung (tidak lewat
    // AppointmentService.updateAppointmentStatus), jadi komisi dijadwalkan di sini.
    await enqueueCommissionCalculation(appointmentId);
  }
};

// Inisialisasi Worker Audit
export let auditWorker: Worker | null = null;
export let appointmentWorker: Worker | null = null;

export const startQueueWorkers = () => {
  if (auditWorker || appointmentWorker) return;

  auditWorker = new Worker(AUDIT_QUEUE, async (job: Job) => {
    const { actor_type, actor_id, action, entity_type, entity_id, before, after, branch_id } = job.data;

    await db.insert(auditLogs).values(
      camelKeys({
        actor_type,
        actor_id,
        action,
        entity_type,
        entity_id,
        before: before ?? null,
        after: after ?? null,
        branch_id: branch_id ?? null
      })
    );
  }, { connection: redis as any });

  auditWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, '[BullMQ Audit] Job failed');
  });

  appointmentWorker = new Worker(
    APPOINTMENT_QUEUE,
    processAppointmentJob,
    { connection: redis as any }
  );

  appointmentWorker.on('completed', job => {
    logger.debug({ jobId: job.id }, '[BullMQ] Job completed');
  });
  appointmentWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, '[BullMQ] Job failed');
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

// Worker in-process HANYA berjalan bila diminta eksplisit. Sebelumnya fallback
// ke `NODE_ENV !== 'production'` membuat job diproses DUA KALI saat menjalankan
// `bun dev` + `bun run worker` bersamaan (atau deploy tanpa set NODE_ENV). (MB2)
const shouldRunWorkersInProcess =
  process.env.RUN_WORKERS_IN_PROCESS === 'true' &&
  process.env.PROCESS_ROLE !== 'worker';

if (shouldRunWorkersInProcess) {
  startQueueWorkers();
}
