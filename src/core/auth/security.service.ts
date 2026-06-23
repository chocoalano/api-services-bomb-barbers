import { createHash } from 'node:crypto';
import { redis } from '../../lib/redis';
import { supabase } from '../../lib/supabase';

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

const getClientIp = (request?: Request) => {
  const forwarded = request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded ||
    request?.headers.get('x-real-ip')?.trim() ||
    request?.headers.get('cf-connecting-ip')?.trim() ||
    'unknown';
};

export const getAuthRequestMetadata = (request?: Request): AuthRequestMetadata => ({
  ipHash: hashSecurityValue(getClientIp(request)),
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
  const { error } = await supabase.from('auth_events' as any).insert({
    user_type: userType,
    user_id: userId || null,
    event_type: eventType,
    success,
    identifier_hash: identifierHash || null,
    ip_hash: ipHash || null,
    metadata: metadata || null
  });

  if (error && !isMissingAuthEventsTable(error)) {
    console.error('[Auth Security] Gagal menulis auth event:', error.message);
  }
};

const getRetryAfter = async (key: string, fallback: number) => {
  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : fallback;
};

export class AuthSecurityService {
  static async assertLoginAllowed(
    userType: AuthUserType,
    identifier: string,
    metadata: AuthRequestMetadata
  ) {
    const identifierHash = hashSecurityValue(normalizeIdentifier(identifier));
    const key = `auth:login:${userType}:${identifierHash}:${metadata.ipHash}`;
    const attempts = Number(await redis.get(key) || 0);

    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      throw new AuthRateLimitError(
        'Terlalu banyak percobaan login. Coba kembali setelah beberapa saat.',
        await getRetryAfter(key, LOGIN_WINDOW_SECONDS)
      );
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
    const attempts = await redis.incr(key);
    if (attempts === 1) {
      await redis.expire(key, LOGIN_WINDOW_SECONDS);
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
    await redis.del(key);
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
    const attempts = await redis.incr(key);
    if (attempts === 1) {
      await redis.expire(key, REFRESH_WINDOW_SECONDS);
    }
    if (attempts > REFRESH_MAX_ATTEMPTS) {
      throw new AuthRateLimitError(
        'Terlalu banyak percobaan refresh token. Coba kembali setelah beberapa saat.',
        await getRetryAfter(key, REFRESH_WINDOW_SECONDS)
      );
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
