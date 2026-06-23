import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Setup connection for standard usage and BullMQ
export const redis = new Redis(redisUrl, { 
  maxRetriesPerRequest: null 
});

export const getBarberStatusKey = (barberId: string) => `barber:status:${barberId}`;
export const getCustomerLocationKey = (appointmentId: string) => `customer:location:${appointmentId}`;
export const getLegacyAppointmentEtaKey = (appointmentId: string) => `appointment:eta:${appointmentId}`;
export const getTrackingSessionKey = (appointmentId: string) => `tracking:${appointmentId}:session`;
export const getTrackingCustomerKey = (appointmentId: string) => `tracking:${appointmentId}:customer`;
export const getTrackingBarberKey = (appointmentId: string) => `tracking:${appointmentId}:barber`;
export const getTrackingRouteKey = (appointmentId: string) => `tracking:${appointmentId}:route`;
export const getTrackingCustomerSequenceKey = (appointmentId: string) => `tracking:${appointmentId}:customer:sequence`;
export const getTrackingBarberSequenceKey = (appointmentId: string) => `tracking:${appointmentId}:barber:sequence`;
export const getTrackingRateLimitKey = (
  actorType: 'customer' | 'barber',
  actorId: string,
  appointmentId: string
) => `tracking:rate:${actorType}:${actorId}:${appointmentId}`;

// Socket.IO pub/sub wajib memakai koneksi terpisah karena koneksi subscriber
// tidak dapat dipakai untuk command Redis biasa.
export const socketPubClient = redis.duplicate({ enableReadyCheck: false });
export const socketSubClient = redis.duplicate({ enableReadyCheck: false });
