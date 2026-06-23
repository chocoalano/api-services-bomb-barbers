import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyAccessToken } from '../middleware/auth';
import { supabase } from './supabase';
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
    return next(new Error('AUTH_REQUIRED: Token tidak ditemukan'));
  }

  try {
    const payload = await verifyAccessToken(token);
    if (!['customer', 'staff'].includes(payload.role)) {
      return next(new Error('AUTH_FORBIDDEN: Role token tidak diizinkan'));
    }

    if (payload.role === 'customer') {
      const { data: customer } = await supabase
        .from('customers')
        .select('id, is_active, deleted_at')
        .eq('id', payload.sub)
        .maybeSingle();
      if (!customer?.is_active || customer.deleted_at) {
        return next(new Error('AUTH_INACTIVE: Akun customer tidak aktif'));
      }
    } else {
      const { data: staff } = await supabase
        .from('staff_users')
        .select('id, is_active, deleted_at')
        .eq('id', payload.sub)
        .maybeSingle();
      if (!staff?.is_active || staff.deleted_at) {
        return next(new Error('AUTH_INACTIVE: Akun staff tidak aktif'));
      }

      const [{ data: barber }, rbac] = await Promise.all([
        supabase
          .from('barbers')
          .select('id')
          .eq('staff_user_id', payload.sub)
          .is('deleted_at', null)
          .maybeSingle(),
        getRbacProfile(payload.sub)
      ]);
      socket.data.barberId = barber?.id || null;
      socket.data.branchIds = rbac.branchIds;
      socket.data.isGlobal = rbac.isGlobal;
    }

    socket.data.userId = payload.sub;
    socket.data.role = payload.role;
    socket.data.tokenExp = payload.exp || null;
    next();
  } catch {
    next(new Error('AUTH_INVALID: Token tidak valid atau sudah kadaluarsa'));
  }
});

io.on('connection', async (socket: Socket) => {
  const { userId, role } = socket.data;
  const tokenExpiryTimer = socket.data.tokenExp
    ? setTimeout(() => {
        socket.emit('auth:expired', { message: 'Access token sudah kedaluwarsa' });
        socket.disconnect(true);
      }, Math.max(0, socket.data.tokenExp * 1000 - Date.now()))
    : null;
  tokenExpiryTimer?.unref();

  socket.on('join_appointment', async (appointmentId: unknown, ack?: SocketAck) => {
    try {
      const id = validateAppointmentId(appointmentId);
      await RealtimeTrackingService.authorizeParticipant(id, getSocketActor(socket));
      await socket.join(`appointment:${id}`);
      acknowledge(ack, { success: true, data: { appointment_id: id } });
    } catch (error: any) {
      acknowledge(ack, { success: false, error: error.message });
    }
  });

  socket.on('leave_appointment', async (appointmentId: unknown, ack?: SocketAck) => {
    try {
      const id = validateAppointmentId(appointmentId);
      await socket.leave(`appointment:${id}`);
      acknowledge(ack, { success: true, data: { appointment_id: id } });
    } catch (error: any) {
      acknowledge(ack, { success: false, error: error.message });
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
      acknowledge(ack, { success: false, error: error.message });
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
      acknowledge(ack, { success: false, error: error.message });
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
      acknowledge(ack, { success: false, error: error.message });
    }
  });

  socket.on('disconnect', (reason) => {
    if (tokenExpiryTimer) clearTimeout(tokenExpiryTimer);
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
};

export const emitAppointmentStatusChanged = (data: AppointmentStatusEvent) => {
  const { appointment_id, barber_id, customer_id, branch_id } = data;

  io.to(`appointment:${appointment_id}`).emit('appointment:status_changed', data);
  if (barber_id) io.to(`barber:${barber_id}`).emit('appointment:status_changed', data);
  if (customer_id) io.to(`customer:${customer_id}`).emit('appointment:status_changed', data);
  if (branch_id) io.to(`branch:${branch_id}`).emit('appointment:status_changed', data);
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
  io.to(`appointment:${data.appointment_id}`).emit('appointment:chat_message', data);
};

export const startSocketServer = (port: number) => {
  io.listen(port);
  return io;
};

export const closeSocketServer = async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
};
