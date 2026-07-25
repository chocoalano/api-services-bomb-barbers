import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyAccessToken } from '../middleware/auth';
import { db } from './db';
import { customers, staffUsers, barbers, appointments, payments } from '../db/schema';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { toDbDate } from '../db/helpers';
import { parseDbTime } from '../db/procedures';
import { jakartaParts } from '../config/booking';
import { resolveOrderStage, CUSTOMER_STATUS_ALIASES } from '../core/appointments/stage';
import { socketPubClient, socketSubClient } from './redis';
import {
  LocationInput,
  RealtimeTrackingService,
  TrackingActor
} from '../core/tracking/service';
import { getRbacProfile } from '../middleware/rbac';
import { logger } from './logger';

const parseOrigins = () => {
  const raw = process.env.SOCKET_CORS_ORIGINS || process.env.CORS_ORIGINS || '';
  if (!raw.trim()) {
    return process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173'];
  }
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
};

const allowedOrigins = parseOrigins();
const websocketOnly = process.env.SOCKET_WEBSOCKET_ONLY === 'true';

export const io = new Server({
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: websocketOnly ? ['websocket'] : ['websocket', 'polling'],
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 25000,
  pingTimeout: 20000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false
  }
});

io.adapter(createAdapter(socketPubClient, socketSubClient));

socketPubClient.on('error', (error) => {
  logger.error({ err: error }, 'Socket.IO Redis publisher error');
});
socketSubClient.on('error', (error) => {
  logger.error({ err: error }, 'Socket.IO Redis subscriber error');
});

type SocketAck = (response: {
  success: boolean;
  data?: unknown;
  error?: string;
}) => void;

const acknowledge = (
  ack: SocketAck | undefined,
  response: Parameters<SocketAck>[0]
) => {
  if (typeof ack === 'function') {
    ack(response);
  }
};

const acknowledgeError = (
  socket: Socket,
  event: string,
  error: any,
  ack?: SocketAck
) => {
  logger.warn(
    {
      err: error,
      event,
      socketId: socket.id,
      userId: socket.data.userId ?? null,
      role: socket.data.role ?? null
    },
    `[Socket] ${event} failed`
  );
  acknowledge(ack, { success: false, error: error?.message ?? 'Socket event gagal' });
};

const getSocketActor = (socket: Socket): TrackingActor => ({
  role: socket.data.role,
  userId: socket.data.userId,
  barberId: socket.data.barberId || null
});

const validateAppointmentId = (appointmentId: unknown) => {
  if (typeof appointmentId !== 'string' || !appointmentId.trim()) {
    throw new Error('appointment_id wajib berupa UUID');
  }
  return appointmentId.trim();
};

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== 'string') {
    logger.warn({ socketId: socket.id }, '[SocketAuth] Token tidak ditemukan');
    return next(new Error('AUTH_REQUIRED: Token tidak ditemukan'));
  }

  try {
    const payload = await verifyAccessToken(token);
    if (!['customer', 'staff'].includes(payload.role)) {
      return next(new Error('AUTH_FORBIDDEN: Role token tidak diizinkan'));
    }

    if (payload.role === 'customer') {
      const [customer] = await db
        .select({ isActive: customers.isActive, deletedAt: customers.deletedAt })
        .from(customers)
        .where(eq(customers.id, payload.sub))
        .limit(1);
      if (!customer?.isActive || customer.deletedAt) {
        logger.warn({ socketId: socket.id, userId: payload.sub, role: payload.role }, '[SocketAuth] Customer tidak aktif');
        return next(new Error('AUTH_INACTIVE: Akun customer tidak aktif'));
      }
    } else {
      const [staff] = await db
        .select({ isActive: staffUsers.isActive, deletedAt: staffUsers.deletedAt })
        .from(staffUsers)
        .where(eq(staffUsers.id, payload.sub))
        .limit(1);
      if (!staff?.isActive || staff.deletedAt) {
        logger.warn({ socketId: socket.id, userId: payload.sub, role: payload.role }, '[SocketAuth] Staff tidak aktif');
        return next(new Error('AUTH_INACTIVE: Akun staff tidak aktif'));
      }

      const [barberRows, rbac] = await Promise.all([
        db
          .select({ id: barbers.id })
          .from(barbers)
          .where(and(eq(barbers.staffUserId, payload.sub), isNull(barbers.deletedAt)))
          .limit(1),
        getRbacProfile(payload.sub)
      ]);
      socket.data.barberId = barberRows[0]?.id || null;
      socket.data.branchIds = rbac.branchIds;
      socket.data.isGlobal = rbac.isGlobal;
    }

    socket.data.userId = payload.sub;
    socket.data.role = payload.role;
    // Sesi disimpan agar socket yang sesinya dicabut bisa ditendang seketika,
    // tanpa menunggu request HTTP berikutnya. (G2)
    socket.data.sessionId = payload.sid;
    next();
  } catch (error) {
    logger.warn({ err: error, socketId: socket.id }, '[SocketAuth] Token tidak valid');
    next(new Error('AUTH_INVALID: Token tidak valid'));
  }
});

io.on('connection', async (socket: Socket) => {
  const { userId, role } = socket.data;

  socket.on('join_appointment', async (appointmentId: unknown, ack?: SocketAck) => {
    try {
      const id = validateAppointmentId(appointmentId);
      await RealtimeTrackingService.authorizeParticipant(id, getSocketActor(socket));
      await socket.join(`appointment:${id}`);
      acknowledge(ack, { success: true, data: { appointment_id: id } });
    } catch (error: any) {
      acknowledgeError(socket, 'join_appointment', error, ack);
    }
  });

  socket.on('leave_appointment', async (appointmentId: unknown, ack?: SocketAck) => {
    try {
      const id = validateAppointmentId(appointmentId);
      await socket.leave(`appointment:${id}`);
      acknowledge(ack, { success: true, data: { appointment_id: id } });
    } catch (error: any) {
      acknowledgeError(socket, 'leave_appointment', error, ack);
    }
  });

  socket.on('push_customer_location', async (data: any, ack?: SocketAck) => {
    try {
      if (role !== 'customer') {
        throw new Error('Hanya customer yang dapat mengirim lokasi customer');
      }
      const appointmentId = validateAppointmentId(data?.appointment_id);
      const location = (data?.customer_location || data?.location || data) as LocationInput;
      const result = await RealtimeTrackingService.updateCustomerLocation(
        appointmentId,
        userId,
        location
      );

      emitCustomerLocation({
        appointment_id: appointmentId,
        customer_location: result.customer_location,
        route: result.route
      });
      acknowledge(ack, { success: true, data: result });
    } catch (error: any) {
      acknowledgeError(socket, 'push_customer_location', error, ack);
    }
  });

  socket.on('push_barber_location', async (data: any, ack?: SocketAck) => {
    try {
      if (role !== 'staff' || !socket.data.barberId) {
        throw new Error('Hanya barber yang dapat mengirim lokasi barber');
      }
      const appointmentId = validateAppointmentId(data?.appointment_id);
      const location = (data?.barber_location || data?.location || data) as LocationInput;
      const result = await RealtimeTrackingService.updateBarberLocation(
        appointmentId,
        userId,
        location
      );

      emitBarberLocation({
        appointment_id: appointmentId,
        barber_location: result.barber_location,
        // Alias legacy sementara untuk frontend lama.
        barbers_location: {
          lat: result.barber_location.lat,
          lng: result.barber_location.lng
        },
        customer_location: result.customer_location,
        route: result.route,
        eta_minutes: result.route?.eta_minutes ?? null,
        distance_km: result.route?.distance_km ?? null,
        timestamp: result.barber_location.received_at
      });
      acknowledge(ack, { success: true, data: result });
    } catch (error: any) {
      acknowledgeError(socket, 'push_barber_location', error, ack);
    }
  });

  socket.on('join_branch', async (branchId: unknown, ack?: SocketAck) => {
    try {
      if (role !== 'staff') {
        throw new Error('Hanya staff yang dapat bergabung ke room cabang');
      }
      if (typeof branchId !== 'string' || !branchId.trim()) {
        throw new Error('branch_id wajib dikirim');
      }
      const id = branchId.trim();
      const allowed = socket.data.isGlobal || socket.data.branchIds?.includes(id);
      if (!allowed) {
        throw new Error('Akses cabang ditolak');
      }

      await socket.join(`branch:${id}`);
      acknowledge(ack, { success: true, data: { branch_id: id } });
    } catch (error: any) {
      acknowledgeError(socket, 'join_branch', error, ack);
    }
  });

  // Room presence per-cabang untuk daftar barber di form Buat Pesanan.
  // Berbeda dari `join_branch` (staff, RBAC penuh): ini hanya menyiarkan status
  // kehadiran barber (online/offline/serving) yang bersifat non-sensitif, jadi
  // customer mana pun boleh berlangganan cabang yang sedang dilihatnya.
  socket.on('join_branch_presence', async (branchId: unknown, ack?: SocketAck) => {
    try {
      if (typeof branchId !== 'string' || !branchId.trim()) {
        throw new Error('branch_id wajib dikirim');
      }
      const id = branchId.trim();
      await socket.join(`branch:presence:${id}`);
      acknowledge(ack, { success: true, data: { branch_id: id } });
    } catch (error: any) {
      acknowledgeError(socket, 'join_branch_presence', error, ack);
    }
  });

  socket.on('leave_branch_presence', async (branchId: unknown, ack?: SocketAck) => {
    try {
      if (typeof branchId !== 'string' || !branchId.trim()) {
        throw new Error('branch_id wajib dikirim');
      }
      const id = branchId.trim();
      await socket.leave(`branch:presence:${id}`);
      acknowledge(ack, { success: true, data: { branch_id: id } });
    } catch (error: any) {
      acknowledgeError(socket, 'leave_branch_presence', error, ack);
    }
  });

  socket.on('disconnect', (reason) => {
    logger.debug({ socketId: socket.id, userId, role, reason }, 'Socket disconnected');
  });

  if (role === 'customer') {
    void socket.join(`customer:${userId}`);
  } else if (socket.data.barberId) {
    void socket.join(`barber:${socket.data.barberId}`);
  }
  // Room per-akun & per-sesi khusus untuk pencabutan (G2).
  void socket.join(`account:${role}:${userId}`);
  if (socket.data.sessionId) {
    void socket.join(`session:${socket.data.sessionId}`);
  }
});

/**
 * Tendang socket yang sesinya baru saja dicabut.
 *
 * Ini SATU-SATUNYA event socket yang boleh berujung pada layar login di
 * aplikasi. Karena itu ia selalu membawa `code` (lihat `session-errors.ts`) —
 * aplikasi mengabaikan `auth:revoked` tanpa kode terminal.
 *
 * @param sessionIds sesi yang dicabut. Kosong = seluruh sesi akun tersebut.
 */
export const disconnectRevokedSessions = async (params: {
  userType: 'customer' | 'staff';
  userId: string;
  sessionIds?: string[];
  code: string;
  message: string;
}) => {
  const payload = { code: params.code, message: params.message };
  const rooms =
    params.sessionIds && params.sessionIds.length > 0
      ? params.sessionIds.map((sid) => `session:${sid}`)
      : [`account:${params.userType}:${params.userId}`];

  for (const room of rooms) {
    io.to(room).emit('auth:revoked', payload);
    try {
      const sockets = await io.in(room).fetchSockets();
      for (const socket of sockets) socket.disconnect(true);
    } catch (error) {
      // Socket yang gagal ditendang bukan alasan menggagalkan pencabutan:
      // sesinya sudah mati di database, request HTTP berikutnya pasti ditolak.
      logger.warn({ err: error, room }, '[SocketRevoke] Gagal memutus socket');
    }
  }
};

export type AppointmentStatusEvent = {
  appointment_id: string;
  status: string;
  raw_status: string;
  barber_id: string | null;
  customer_id: string | null;
  branch_id: string | null;
  timestamp: string;
  /** Versi baris appointment — klien menolak event yang lebih tua. */
  version?: number;
  /** Tahapan kanonik hasil `resolveOrderStage`; absen pada emit legacy. */
  stage?: unknown;
  journey_status?: string;
  payment_status?: string;
  queue_position?: number | null;
  updated_at?: string | null;
  server_time?: string;
  /** Penyebab emisi — untuk penelusuran, bukan untuk logika klien. */
  reason?: string;
};

export type BarberLocationEvent = {
  appointment_id: string;
  barber_location: unknown;
  /** @deprecated Gunakan barber_location. */
  barbers_location: { lat: number; lng: number };
  customer_location: unknown | null;
  route: unknown | null;
  eta_minutes: number | null;
  distance_km?: number | null;
  timestamp: string;
};

export type NewOrderEvent = {
  appointment_id: string;
  timestamp: string;
};

export type CustomerLocationEvent = {
  appointment_id: string;
  customer_location: unknown;
  route: unknown;
};

export type ChatMessageEvent = {
  id: string;
  appointment_id: string;
  sender_id: string;
  sender_role: 'customer' | 'barber';
  text: string;
  created_at: string;
  /** Untuk delivery ke room personal penerima (badge unread global). */
  customer_id?: string | null;
  barber_id?: string | null;
};

export const emitAppointmentStatusChanged = (
  data: AppointmentStatusEvent,
  extraRooms: string[] = []
) => {
  const { appointment_id, barber_id, customer_id, branch_id } = data;

  // Gabungkan seluruh room ke dalam SATU emit (deduped) agar socket yang
  // tergabung di lebih dari satu room — mis. customer yang sedang di room
  // `appointment:<id>` DAN room personal `customer:<id>` — hanya menerima event
  // SEKALI. Emit terpisah per-room membuat event dobel → double refetch/toast.
  // Pola sama dengan emitChatMessage.
  let target = io.to(`appointment:${appointment_id}`);
  if (barber_id) target = target.to(`barber:${barber_id}`);
  if (customer_id) target = target.to(`customer:${customer_id}`);
  if (branch_id) target = target.to(`branch:${branch_id}`);
  // Room tambahan untuk pihak yang TIDAK lagi tercatat pada baris appointment —
  // mis. barber lama saat order dialihkan; tanpa ini kartunya lenyap diam-diam.
  for (const room of extraRooms) target = target.to(room);
  target.emit('appointment:status_changed', data);
};

/**
 * SATU PINTU emisi perubahan keadaan pesanan.
 *
 * Sebelumnya payload hanya berisi `{id, status}` sehingga setiap klien wajib
 * melakukan refetch penuh, dan setiap alur baru (perubahan `journey_status`,
 * pembayaran lunas lewat verifikasi barber, dsb.) harus ingat memanggil emit
 * sendiri — beberapa di antaranya memang terlupa. Fungsi ini membaca keadaan
 * terkini satu kali lalu menyiarkan tahapan kanonik yang lengkap, sehingga
 * klien cukup menambal satu kartu tanpa memuat ulang seluruh daftar.
 *
 * Kegagalan memuat state TIDAK boleh menggagalkan aksi yang memicunya; error
 * dicatat dan emisi dilewati (polling klien tetap menjadi jaring pengaman).
 */
export const emitAppointmentStateChanged = async (
  appointmentId: string,
  reason: string,
  options: { alsoNotifyBarberIds?: string[] } = {}
): Promise<void> => {
  try {
    const [row] = await db
      .select({
        id: appointments.id,
        status: appointments.status,
        journey_status: appointments.journeyStatus,
        barber_id: appointments.barberId,
        customer_id: appointments.customerId,
        branch_id: appointments.branchId,
        queue_position: appointments.queuePosition,
        fulfillment_type: appointments.fulfillmentType,
        source: appointments.source,
        scheduled_at: appointments.scheduledAt,
        checked_in_at: appointments.checkedInAt,
        started_at: appointments.startedAt,
        completed_at: appointments.completedAt,
        version: appointments.version,
        updated_at: appointments.updatedAt
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);

    if (!row) {
      logger.warn({ appointmentId, reason }, '[Socket] Appointment tidak ditemukan saat emit state');
      return;
    }

    const [payment] = await db
      .select({ status: payments.status, paid_at: payments.paidAt })
      .from(payments)
      .where(eq(payments.appointmentId, appointmentId))
      .limit(1);

    const paymentStatus = payment?.status ?? 'unpaid';
    const stage = resolveOrderStage({
      status: row.status,
      journey_status: row.journey_status,
      payment_status: paymentStatus,
      fulfillment_type: row.fulfillment_type,
      source: row.source,
      checked_in_at: row.checked_in_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      paid_at: payment?.paid_at ?? null
    });

    emitAppointmentStatusChanged({
      appointment_id: appointmentId,
      status: CUSTOMER_STATUS_ALIASES[row.status] ?? row.status,
      raw_status: row.status,
      barber_id: row.barber_id ?? null,
      customer_id: row.customer_id ?? null,
      branch_id: row.branch_id ?? null,
      timestamp: new Date().toISOString(),
      version: Number(row.version ?? 1),
      stage,
      journey_status: row.journey_status ?? 'not_started',
      payment_status: paymentStatus,
      queue_position: row.queue_position ?? null,
      updated_at: row.updated_at ?? null,
      server_time: new Date().toISOString(),
      reason
    }, (options.alsoNotifyBarberIds ?? [])
      .filter((id) => id && id !== row.barber_id)
      .map((id) => `barber:${id}`));

    // Perubahan status satu pesanan in-store menggeser antrean pesanan lain di
    // hari & barber yang sama. Perubahan pembayaran tidak menggeser apa pun,
    // jadi tidak perlu menghitung ulang antrean untuk itu.
    if (row.fulfillment_type !== 'home_service' && !reason.startsWith('payment:')) {
      await emitQueuePositionsForBranch({
        branchId: row.branch_id,
        barberId: row.barber_id ?? null,
        scheduledAt: row.scheduled_at ?? null
      });
    }
  } catch (error) {
    logger.error({ err: error, appointmentId, reason }, '[Socket] Gagal menyiarkan perubahan pesanan');
  }
};

export type QueuePositionEvent = {
  appointment_id: string;
  branch_id: string;
  queue_position: number;
  people_ahead: number;
  timestamp: string;
};

/** Status yang benar-benar menempati antrean layanan (samakan dengan serializer). */
const QUEUE_OCCUPYING_STATUSES = ['confirmed', 'in_queue', 'in_service'];

/**
 * Siarkan posisi antrean terbaru ke SETIAP customer yang antreannya bergeser.
 *
 * Saat satu pesanan selesai/batal, seluruh pesanan di belakangnya maju — tetapi
 * hanya pemilik pesanan yang berubah statuslah yang selama ini menerima event.
 * Customer lain baru tahu setelah polling, sehingga "ada N orang di depan Anda"
 * tertinggal. Emisi dikirim ke room personal masing-masing (`customer:<id>`)
 * agar tidak ada data pesanan orang lain yang bocor.
 */
export const emitQueuePositionsForBranch = async (params: {
  branchId: string;
  barberId: string | null;
  scheduledAt: string | null;
}): Promise<void> => {
  const { branchId, barberId, scheduledAt } = params;
  if (!branchId || !scheduledAt) return;

  try {
    const anchor = parseDbTime(scheduledAt);
    if (Number.isNaN(anchor.getTime())) return;
    const day = jakartaParts(anchor).date;
    const from = toDbDate(new Date(anchor.getTime() - 24 * 60 * 60 * 1000))!;
    const to = toDbDate(new Date(anchor.getTime() + 24 * 60 * 60 * 1000))!;

    const rows = await db
      .select({
        id: appointments.id,
        customer_id: appointments.customerId,
        barber_id: appointments.barberId,
        status: appointments.status,
        scheduled_at: appointments.scheduledAt,
        created_at: appointments.createdAt
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.branchId, branchId),
          eq(appointments.fulfillmentType, 'in_store'),
          inArray(appointments.status, ['pending', ...QUEUE_OCCUPYING_STATUSES] as any),
          gte(appointments.scheduledAt, from),
          lte(appointments.scheduledAt, to)
        )
      );

    // Antrean dikelompokkan per barber: pesanan barber lain tidak menghalangi.
    const group = rows.filter(
      (r) =>
        r.scheduled_at &&
        jakartaParts(parseDbTime(r.scheduled_at)).date === day &&
        (r.barber_id ?? null) === (barberId ?? null)
    );
    if (!group.length) return;

    const timestamp = new Date().toISOString();
    for (const row of group) {
      if (!row.customer_id || !row.scheduled_at) continue;
      const selfAt = parseDbTime(row.scheduled_at).getTime();
      const selfCreated = row.created_at ? parseDbTime(row.created_at).getTime() : 0;
      const ahead = group.filter((peer) => {
        if (peer.id === row.id) return false;
        if (!QUEUE_OCCUPYING_STATUSES.includes(peer.status)) return false;
        if (!peer.scheduled_at) return false;
        const peerAt = parseDbTime(peer.scheduled_at).getTime();
        if (peerAt !== selfAt) return peerAt < selfAt;
        const peerCreated = peer.created_at ? parseDbTime(peer.created_at).getTime() : 0;
        return peerCreated < selfCreated;
      }).length;

      const event: QueuePositionEvent = {
        appointment_id: row.id,
        branch_id: branchId,
        queue_position: ahead + 1,
        people_ahead: ahead,
        timestamp
      };
      io.to(`customer:${row.customer_id}`).emit('appointment:queue_changed', event);
    }
  } catch (error) {
    logger.error({ err: error, branchId }, '[Socket] Gagal menyiarkan pergeseran antrean');
  }
};

export const emitBarberLocation = (data: BarberLocationEvent) => {
  io.to(`appointment:${data.appointment_id}`).emit('appointment:barber_location', data);
};

export const emitCustomerLocation = (data: CustomerLocationEvent) => {
  io.to(`appointment:${data.appointment_id}`).emit('appointment:customer_location', data);
};

export const emitNewOrder = (barberId: string, event: NewOrderEvent) => {
  io.to(`barber:${barberId}`).emit('appointment:new_order', event);
};

export const emitChatMessage = (data: ChatMessageEvent) => {
  // Satu emit ke gabungan room agar socket yang tergabung di lebih dari satu
  // room (mis. sedang di layar tracking DAN room personalnya) hanya menerima
  // event SEKALI. Room personal (customer:/barber:) selalu tergabung selama
  // socket hidup, sehingga badge unread global tetap bertambah walau penerima
  // tidak sedang berada di room appointment.
  let target = io.to(`appointment:${data.appointment_id}`);
  if (data.customer_id) target = target.to(`customer:${data.customer_id}`);
  if (data.barber_id) target = target.to(`barber:${data.barber_id}`);
  target.emit('appointment:chat_message', data);
};

export type WalletRefundEvent = {
  customer_id: string;
  appointment_id: string;
  amount: number;
  new_balance: number;
};

export const emitWalletRefundCredited = (data: WalletRefundEvent) => {
  io.to(`customer:${data.customer_id}`).emit('wallet:refund_credited', data);
};

export type BarberStatusEvent = {
  barber_id: string;
  branch_id: string;
  /** Status kanonik (available|serving|on_break|offline) hasil normalizeLiveStatus. */
  live_status: string;
  timestamp: string;
};

/**
 * Siarkan perubahan status kehadiran barber ke semua customer yang sedang
 * melihat daftar barber cabang tersebut. Dipanggil dari satu pintu tulis
 * `setBarberLiveStatus` (presence.service.ts) sehingga toggle barber, transisi
 * lifecycle (serving/available), dan aksi admin semuanya realtime.
 */
export const emitBarberStatusChanged = (data: BarberStatusEvent) => {
  io.to(`branch:presence:${data.branch_id}`).emit('barber:status_changed', data);
};

export const startSocketServer = (port: number) => {
  io.listen(port);
  return io;
};

export const closeSocketServer = async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
};
