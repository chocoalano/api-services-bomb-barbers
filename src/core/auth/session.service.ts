import { createHash } from 'node:crypto';
import { redis } from '../../lib/redis';
import { db } from '../../lib/db';
import { snakeKeys, toDbDate } from '../../db/helpers';
import { authSessions } from '../../db/schema';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { AuthRequestMetadata, AuthUserType } from './security.service';

// Jalankan operasi DB; kembalikan null bila tabel auth_sessions belum ada
// (kompatibilitas dgn deploy lama), lempar error lain apa adanya.
async function tolerateMissingTable<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e: any) {
    if (isMissingSessionTable(e)) return null;
    throw e;
  }
}

const NON_EXPIRING_SESSION_EXPIRES_AT = '9999-12-31T23:59:59.999Z';
const SESSION_CACHE_TTL_SECONDS = Number(process.env.AUTH_SESSION_CACHE_TTL_SECONDS || 5 * 60);
const SESSION_KEY_PREFIX = 'auth:session:';

type SessionRecord = {
  id: string;
  user_type: AuthUserType;
  user_id: string;
  refresh_jti_hash: string;
  expires_at: string;
  revoked_at: string | null;
};

const hashJti = (jti: string) =>
  createHash('sha256').update(jti).digest('hex');

const sessionKey = (sessionId: string) => `${SESSION_KEY_PREFIX}${sessionId}`;

const isMissingSessionTable = (error: any) =>
  error?.code === '42P01' ||
  error?.code === 'PGRST205' ||
  String(error?.message || '').includes('auth_sessions');

const cacheSession = async (session: SessionRecord) => {
  await redis.set(
    sessionKey(session.id),
    JSON.stringify(session),
    'EX',
    SESSION_CACHE_TTL_SECONDS
  );
};

const readCachedSession = async (sessionId: string): Promise<SessionRecord | null> => {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    await redis.del(sessionKey(sessionId));
    return null;
  }
};

const loadSession = async (sessionId: string): Promise<SessionRecord | null> => {
  const cached = await readCachedSession(sessionId);
  if (cached) return cached;

  const rows = await tolerateMissingTable(() =>
    db
      .select({
        id: authSessions.id,
        user_type: authSessions.userType,
        user_id: authSessions.userId,
        refresh_jti_hash: authSessions.refreshJtiHash,
        expires_at: authSessions.expiresAt,
        revoked_at: authSessions.revokedAt
      })
      .from(authSessions)
      .where(eq(authSessions.id, sessionId))
      .limit(1)
  );

  const data = rows?.[0];
  if (!data) return null;

  const session = snakeKeys(data) as SessionRecord;
  await cacheSession(session);
  return session;
};

export class AuthSessionService {
  static getRefreshTtlSeconds() {
    return null;
  }

  static async create(
    userType: AuthUserType,
    userId: string,
    refreshJti: string,
    metadata: AuthRequestMetadata
  ) {
    const id = crypto.randomUUID();
    const expiresAt = NON_EXPIRING_SESSION_EXPIRES_AT;
    const session: SessionRecord = {
      id,
      user_type: userType,
      user_id: userId,
      refresh_jti_hash: hashJti(refreshJti),
      expires_at: expiresAt,
      revoked_at: null
    };

    await tolerateMissingTable(() =>
      db.insert(authSessions).values({
        id: session.id,
        userType: session.user_type,
        userId: session.user_id,
        refreshJtiHash: session.refresh_jti_hash,
        expiresAt: toDbDate(session.expires_at),
        revokedAt: null,
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        lastUsedAt: toDbDate(new Date())
      } as any)
    );

    await cacheSession(session);
    return { id, expiresAt };
  }

  static async assertActive(
    sessionId: string,
    userType: AuthUserType,
    userId: string
  ) {
    const session = await loadSession(sessionId);
    if (
      !session ||
      session.user_type !== userType ||
      session.user_id !== userId ||
      session.revoked_at
    ) {
      throw new Error('Session tidak aktif atau sudah dicabut');
    }
    return session;
  }

  static async rotate(
    sessionId: string,
    userType: AuthUserType,
    userId: string,
    currentRefreshJti: string,
    newRefreshJti: string
  ) {
    const lockKey = `auth:session:${sessionId}:rotate-lock`;
    const lockValue = crypto.randomUUID();
    const lockAcquired = await redis.set(lockKey, lockValue, 'EX', 5, 'NX');
    if (!lockAcquired) {
      throw new Error('Refresh token sedang diproses, coba kembali');
    }

    try {
      const session = await this.assertActive(sessionId, userType, userId);
      const currentHash = hashJti(currentRefreshJti);
      if (session.refresh_jti_hash !== currentHash) {
        await this.revoke(sessionId, 'refresh_token_reuse_detected');
        throw new Error('Refresh token sudah digunakan atau session telah dicabut');
      }

      const newHash = hashJti(newRefreshJti);
      const now = toDbDate(new Date());
      const res = await tolerateMissingTable(() =>
        db
          .update(authSessions)
          .set({ refreshJtiHash: newHash, lastUsedAt: now, updatedAt: now } as any)
          .where(
            and(
              eq(authSessions.id, sessionId),
              eq(authSessions.refreshJtiHash, currentHash),
              isNull(authSessions.revokedAt)
            )
          )
      );

      // res null = tabel belum ada (diabaikan). Jika ada tapi tak ada baris ter-update
      // (affectedRows 0), berarti token sudah dipakai/di-revoke → deteksi reuse.
      const affected = res ? ((res as any)[0]?.affectedRows ?? 0) : null;
      if (affected === 0) {
        await this.revoke(sessionId, 'refresh_token_reuse_detected');
        throw new Error('Refresh token sudah digunakan atau session telah dicabut');
      }

      await cacheSession({
        ...session,
        refresh_jti_hash: newHash
      });
    } finally {
      const currentLock = await redis.get(lockKey);
      if (currentLock === lockValue) {
        await redis.del(lockKey);
      }
    }
  }

  /**
   * Revoke semua session milik user tertentu, kecuali `exceptSessionId` (session saat ini).
   * Digunakan setelah perubahan password untuk memaksa logout di device lain.
   */
  static async revokeAllByUser(
    userType: AuthUserType,
    userId: string,
    exceptSessionId?: string
  ) {
    const revokedAt = toDbDate(new Date());

    // Ambil semua session aktif untuk user ini
    const sessions = await tolerateMissingTable(() =>
      db
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(
          and(
            eq(authSessions.userType, userType),
            eq(authSessions.userId, userId),
            isNull(authSessions.revokedAt)
          )
        )
    );

    const sessionIds = (sessions ?? [])
      .map((s) => s.id as string)
      .filter((id: string) => id !== exceptSessionId);

    if (sessionIds.length === 0) return;

    // Batch revoke di database
    await tolerateMissingTable(() =>
      db
        .update(authSessions)
        .set({ revokedAt, revokeReason: 'password_changed', updatedAt: revokedAt } as any)
        .where(and(inArray(authSessions.id, sessionIds), isNull(authSessions.revokedAt)))
    );

    // Hapus cache Redis untuk semua session yang di-revoke
    for (const sid of sessionIds) {
      await redis.del(sessionKey(sid));
    }
  }

  static async revoke(sessionId: string, reason = 'logout') {
    const revokedAt = toDbDate(new Date());
    await tolerateMissingTable(() =>
      db
        .update(authSessions)
        .set({ revokedAt, revokeReason: reason, updatedAt: revokedAt } as any)
        .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
    );
    await redis.del(sessionKey(sessionId));
  }
}
