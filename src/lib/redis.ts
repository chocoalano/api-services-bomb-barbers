import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Reconnect terjadwal dengan backoff eksponensial terbatas (cap 3 detik) agar
// tidak reconnect-storm saat Redis flapping. (HB4)
const retryStrategy = (times: number) => Math.min(times * 200, 3000);

// Koneksi utama (dipakai BullMQ + operasi umum). BullMQ mensyaratkan
// `maxRetriesPerRequest: null`, jadi jangan pasang commandTimeout di sini
// (akan mematikan blocking command BullMQ).
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy,
  reconnectOnError: () => true
});

// Koneksi fail-fast untuk jalur latency-sensitif (mis. rate-limit login): bila
// Redis down, command gagal cepat alih-alih menggantung. (HB4)
export const appRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 1000,
  retryStrategy
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
