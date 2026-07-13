import { createHash } from 'node:crypto';
import { appRedis } from '../../lib/redis';
import { db } from '../../lib/db';
import { camelKeys } from '../../db/helpers';
import { authEvents } from '../../db/schema';
import { logger } from '../../lib/logger';

export type AuthUserType = 'customer' | 'staff';

export type AuthRequestMetadata = {
  ipHash: string;
  userAgent: string | null;
};

const LOGIN_WINDOW_SECONDS = Number(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS || 900);
const LOGIN_MAX_ATTEMPTS = Number(
  process.env.AUTH_LOGIN_RATE_LIMIT_MAX ||
  (process.env.NODE_ENV === 'production' ? 5 : 50)
);
const REFRESH_WINDOW_SECONDS = Number(process.env.AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS || 60);
const REFRESH_MAX_ATTEMPTS = Number(
  process.env.AUTH_REFRESH_RATE_LIMIT_MAX ||
  (process.env.NODE_ENV === 'production' ? 20 : 100)
);

export class AuthRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const hashSecurityValue = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const normalizeIdentifier = (identifier: string) =>
  identifier.trim().toLowerCase();

// Hanya percayai header X-Forwarded-For bila server memang berada di belakang
// reverse proxy tepercaya yang menuliskan ulang header tersebut. Jika tidak,
// klien bisa memalsukan XFF untuk mereset bucket rate-limit (brute-force tanpa
// batas) dan meracuni auth_events. (H4)
const TRUST_PROXY = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';

const getClientIp = (request?: Request, server?: any): string => {
  if (TRUST_PROXY) {
    const forwarded = request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    const realIp = request?.headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
    const cfIp = request?.headers.get('cf-connecting-ip')?.trim();
    if (cfIp) return cfIp;
  }

  // Default: IP koneksi TCP yang tidak dapat dipalsukan klien.
  const connectionIp = server?.requestIP?.(request)?.address;
  return connectionIp || 'unknown';
};

export const getAuthRequestMetadata = (request?: Request, server?: any): AuthRequestMetadata => ({
  ipHash: hashSecurityValue(getClientIp(request, server)),
  userAgent: request?.headers.get('user-agent')?.slice(0, 500) || null
});

const isMissingAuthEventsTable = (error: any) =>
  error?.code === '42P01' ||
  error?.code === 'PGRST205' ||
  String(error?.message || '').includes('auth_events');

const writeAuthEvent = async ({
  userType,
  userId,
  eventType,
  success,
  identifierHash,
  ipHash,
  metadata
}: {
  userType: AuthUserType;
  userId?: string | null;
  eventType: string;
  success: boolean;
  identifierHash?: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  try {
    await db.insert(authEvents).values(
      camelKeys({
        user_type: userType,
        user_id: userId || null,
        event_type: eventType,
        success,
        identifier_hash: identifierHash || null,
        ip_hash: ipHash || null,
        metadata: metadata || null
      })
    );
  } catch (error: any) {
    if (!isMissingAuthEventsTable(error)) {
      logger.error({ err: error }, '[Auth Security] Gagal menulis auth event');
    }
  }
};

const getRetryAfter = async (key: string, fallback: number) => {
  try {
    const ttl = await appRedis.ttl(key);
    return ttl > 0 ? ttl : fallback;
  } catch {
    return fallback;
  }
};

export class AuthSecurityService {
  static async assertLoginAllowed(
    userType: AuthUserType,
    identifier: string,
    metadata: AuthRequestMetadata
  ) {
    const identifierHash = hashSecurityValue(normalizeIdentifier(identifier));
    const key = `auth:login:${userType}:${identifierHash}:${metadata.ipHash}`;

    // Fail-open bila Redis tidak tersedia: login tetap jalan (rate-limit best-effort)
    // alih-alih menggantung/gagal total. Kegagalan Redis dilog. (HB4)
    try {
      const attempts = Number(await appRedis.get(key) || 0);
      if (attempts >= LOGIN_MAX_ATTEMPTS) {
        throw new AuthRateLimitError(
          'Terlalu banyak percobaan login. Coba kembali setelah beberapa saat.',
          await getRetryAfter(key, LOGIN_WINDOW_SECONDS)
        );
      }
    } catch (err) {
      if (err instanceof AuthRateLimitError) throw err;
      logger.warn({ err }, '[Auth Security] Redis tidak tersedia saat cek rate-limit login; fail-open');
    }

    return { key, identifierHash };
  }

  static async recordLoginFailure({
    userType,
    userId,
    key,
    identifierHash,
    metadata,
    reason
  }: {
    userType: AuthUserType;
    userId?: string | null;
    key: string;
    identifierHash: string;
    metadata: AuthRequestMetadata;
    reason: string;
  }) {
    try {
      const attempts = await appRedis.incr(key);
      if (attempts === 1) {
        await appRedis.expire(key, LOGIN_WINDOW_SECONDS);
      }
    } catch (err) {
      logger.warn({ err }, '[Auth Security] Gagal mencatat kegagalan login ke Redis');
    }

    await writeAuthEvent({
      userType,
      userId,
      eventType: 'login_failed',
      success: false,
      identifierHash,
      ipHash: metadata.ipHash,
      metadata: { reason }
    });
  }

  static async recordLoginSuccess({
    userType,
    userId,
    key,
    identifierHash,
    metadata
  }: {
    userType: AuthUserType;
    userId: string;
    key: string;
    identifierHash: string;
    metadata: AuthRequestMetadata;
  }) {
    try {
      await appRedis.del(key);
    } catch (err) {
      logger.warn({ err }, '[Auth Security] Gagal menghapus counter login di Redis');
    }
    await writeAuthEvent({
      userType,
      userId,
      eventType: 'login_succeeded',
      success: true,
      identifierHash,
      ipHash: metadata.ipHash
    });
  }

  static async assertRefreshAllowed(metadata: AuthRequestMetadata) {
    const key = `auth:refresh:${metadata.ipHash}`;
    try {
      const attempts = await appRedis.incr(key);
      if (attempts === 1) {
        await appRedis.expire(key, REFRESH_WINDOW_SECONDS);
      }
      if (attempts > REFRESH_MAX_ATTEMPTS) {
        throw new AuthRateLimitError(
          'Terlalu banyak percobaan refresh token. Coba kembali setelah beberapa saat.',
          await getRetryAfter(key, REFRESH_WINDOW_SECONDS)
        );
      }
    } catch (err) {
      if (err instanceof AuthRateLimitError) throw err;
      logger.warn({ err }, '[Auth Security] Redis tidak tersedia saat cek rate-limit refresh; fail-open');
    }
  }

  static async recordSessionEvent(
    userType: AuthUserType,
    userId: string,
    eventType: 'token_refreshed' | 'logout',
    metadata: AuthRequestMetadata
  ) {
    await writeAuthEvent({
      userType,
      userId,
      eventType,
      success: true,
      ipHash: metadata.ipHash
    });
  }
}
