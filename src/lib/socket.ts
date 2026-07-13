import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyAccessToken } from '../middleware/auth';
import { db } from './db';
import { customers, staffUsers, barbers } from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
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

  socket.on('disconnect', (reason) => {
    logger.debug({ socketId: socket.id, userId, role, reason }, 'Socket disconnected');
  });

  if (role === 'customer') {
    void socket.join(`customer:${userId}`);
  } else if (socket.data.barberId) {
    void socket.join(`barber:${socket.data.barberId}`);
  }
});

export type AppointmentStatusEvent = {
  appointment_id: string;
  status: string;
  raw_status: string;
  barber_id: string | null;
  customer_id: string | null;
  branch_id: string | null;
  timestamp: string;
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

export const emitAppointmentStatusChanged = (data: AppointmentStatusEvent) => {
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
  target.emit('appointment:status_changed', data);
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

export const startSocketServer = (port: number) => {
  io.listen(port);
  return io;
};

export const closeSocketServer = async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
};
