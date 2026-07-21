import { createHash } from 'node:crypto';
import { redis } from '../../lib/redis';
import { db } from '../../lib/db';
import { snakeKeys, toDbDate } from '../../db/helpers';
import { authSessions } from '../../db/schema';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { AuthRequestMetadata, AuthUserType } from './security.service';
import { SessionError } from './session-errors';
import { logger } from '../../lib/logger';

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

/**
 * Sentinel "sesi tanpa masa berlaku". Baris lama memakai nilai ini dan TETAP
 * sah selamanya — itu yang membuat pengaktifan masa berlaku tidak melogout
 * siapa pun saat rilis.
 */
const NON_EXPIRING_SESSION_EXPIRES_AT = '9999-12-31T23:59:59.999Z';
const SESSION_CACHE_TTL_SECONDS = Number(process.env.AUTH_SESSION_CACHE_TTL_SECONDS || 5 * 60);
const SESSION_KEY_PREFIX = 'auth:session:';

/**
 * Masa berlaku sesi (refresh token) dalam hari. **0 = tanpa batas** dan itulah
 * default-nya, sesuai persyaratan klien "tidak ada yang terlogout kecuali ia
 * menekan Logout". Diisi angka > 0 = jendela geser (sliding): setiap kali token
 * disegarkan, masa berlakunya diperpanjang lagi, sehingga hanya sesi yang
 * benar-benar menganggur selama itu yang berakhir.
 */
const REFRESH_TTL_DAYS = Number(process.env.AUTH_REFRESH_TTL_DAYS || 0);

/**
 * Jendela toleransi rotasi refresh token (detik).
 *
 * Respons refresh bisa hilang di jalan (jaringan putus tepat setelah server
 * merotasi jti). Klien lalu mencoba lagi dengan jti lama — dan tanpa toleransi
 * ini server membacanya sebagai "token dicuri" lalu mencabut sesi, yaitu logout
 * tanpa sebab. Di dalam jendela ini, jti sebelumnya masih diterima sekali lagi.
 */
const ROTATION_GRACE_SECONDS = Number(
  process.env.AUTH_REFRESH_ROTATION_GRACE_SECONDS || 60
);

type SessionRecord = {
  id: string;
  user_type: AuthUserType;
  user_id: string;
  refresh_jti_hash: string;
  prev_refresh_jti_hash: string | null;
  prev_jti_expires_at: string | null;
  expires_at: string;
  revoked_at: string | null;
};

const isNonExpiring = (expiresAt: string | null | undefined) =>
  !expiresAt || expiresAt.startsWith('9999');

/** Sesi sudah lewat masa berlakunya? Sentinel 9999 selalu dianggap belum. */
const isExpired = (session: SessionRecord) => {
  if (isNonExpiring(session.expires_at)) return false;
  const expiry = new Date(session.expires_at).getTime();
  if (!Number.isFinite(expiry)) return false;
  return expiry <= Date.now();
};

const computeExpiresAt = () =>
  REFRESH_TTL_DAYS > 0
    ? new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000).toISOString()
    : NON_EXPIRING_SESSION_EXPIRES_AT;

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

/**
 * Kolom toleransi rotasi belum ada (migrasi `0001_auth_session_expiry.sql` belum
 * dijalankan). Ini HARUS ditangani, bukan dibiarkan melempar: kalau tidak, deploy
 * yang mendahului migrasi akan menolak SEMUA token sekaligus — logout massal,
 * persis yang dilarang.
 */
const isMissingRotationColumns = (error: any) =>
  error?.code === 'ER_BAD_FIELD_ERROR' ||
  error?.code === '42S22' ||
  String(error?.message || '').includes('prev_refresh_jti_hash');

const loadSession = async (sessionId: string): Promise<SessionRecord | null> => {
  const cached = await readCachedSession(sessionId);
  if (cached) return cached;

  const baseColumns = {
    id: authSessions.id,
    user_type: authSessions.userType,
    user_id: authSessions.userId,
    refresh_jti_hash: authSessions.refreshJtiHash,
    expires_at: authSessions.expiresAt,
    revoked_at: authSessions.revokedAt
  };

  const rows = await tolerateMissingTable(async () => {
    try {
      return await db
        .select({
          ...baseColumns,
          prev_refresh_jti_hash: authSessions.prevRefreshJtiHash,
          prev_jti_expires_at: authSessions.prevJtiExpiresAt
        })
        .from(authSessions)
        .where(eq(authSessions.id, sessionId))
        .limit(1);
    } catch (error: any) {
      if (!isMissingRotationColumns(error)) throw error;
      logger.warn(
        '[AuthSession] Kolom toleransi rotasi belum ada — jalankan migrasi ' +
          'drizzle/0001_auth_session_expiry.sql. Sesi tetap berjalan tanpa ' +
          'jendela toleransi.'
      );
      const legacy = await db
        .select(baseColumns)
        .from(authSessions)
        .where(eq(authSessions.id, sessionId))
        .limit(1);
      return legacy.map((row) => ({
        ...row,
        prev_refresh_jti_hash: null,
        prev_jti_expires_at: null
      }));
    }
  });

  const data = rows?.[0];
  if (!data) return null;

  const session = snakeKeys(data) as SessionRecord;
  await cacheSession(session);
  return session;
};

export class AuthSessionService {
  /** null = sesi tidak pernah kedaluwarsa (AUTH_REFRESH_TTL_DAYS=0). */
  static getRefreshTtlSeconds() {
    return REFRESH_TTL_DAYS > 0 ? REFRESH_TTL_DAYS * 86_400 : null;
  }

  static async create(
    userType: AuthUserType,
    userId: string,
    refreshJti: string,
    metadata: AuthRequestMetadata
  ) {
    const id = crypto.randomUUID();
    const expiresAt = computeExpiresAt();
    const session: SessionRecord = {
      id,
      user_type: userType,
      user_id: userId,
      refresh_jti_hash: hashJti(refreshJti),
      prev_refresh_jti_hash: null,
      prev_jti_expires_at: null,
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
      throw SessionError.revoked('Sesi tidak aktif atau sudah dicabut');
    }
    // Masa berlaku baru benar-benar dievaluasi di sini. Baris sentinel 9999
    // (semua sesi lama, dan semua sesi baru selama AUTH_REFRESH_TTL_DAYS=0)
    // tidak pernah dianggap kedaluwarsa.
    if (isExpired(session)) {
      throw SessionError.revoked('Sesi sudah kedaluwarsa');
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

      // Toleransi rotasi: jti sebelumnya masih diterima selama jendela grace,
      // karena penyebab paling sering "jti lama dipakai lagi" bukan pencurian
      // melainkan respons rotasi yang hilang di jaringan lalu di-retry.
      const withinGrace =
        !!session.prev_refresh_jti_hash &&
        session.prev_refresh_jti_hash === currentHash &&
        !!session.prev_jti_expires_at &&
        new Date(session.prev_jti_expires_at).getTime() > Date.now();

      if (session.refresh_jti_hash !== currentHash && !withinGrace) {
        await this.revoke(sessionId, 'refresh_token_reuse_detected');
        throw SessionError.revoked(
          'Refresh token sudah digunakan atau sesi telah dicabut'
        );
      }

      const newHash = hashJti(newRefreshJti);
      const now = toDbDate(new Date());
      // Jti yang barusan dipakai disimpan sebagai "sebelumnya" agar retry dalam
      // jendela grace tetap diterima.
      const prevHash = withinGrace ? session.prev_refresh_jti_hash : currentHash;
      const prevExpiresAt = new Date(
        Date.now() + ROTATION_GRACE_SECONDS * 1000
      ).toISOString();
      // Sliding: tiap pemakaian memperpanjang masa berlaku, jadi pengguna aktif
      // tidak akan pernah menyentuh batas (dan dengan TTL=0 tetap sentinel).
      const nextExpiresAt = computeExpiresAt();

      const res = await tolerateMissingTable(async () => {
        const where = and(
          eq(authSessions.id, sessionId),
          isNull(authSessions.revokedAt)
        );
        const base = {
          refreshJtiHash: newHash,
          expiresAt: toDbDate(nextExpiresAt),
          lastUsedAt: now,
          updatedAt: now
        };
        try {
          return await db
            .update(authSessions)
            .set({
              ...base,
              prevRefreshJtiHash: prevHash,
              prevJtiExpiresAt: toDbDate(prevExpiresAt)
            } as any)
            .where(where);
        } catch (error: any) {
          // Migrasi belum jalan: tetap rotasi (tanpa jendela toleransi) daripada
          // menggagalkan refresh dan memaksa pengguna login ulang.
          if (!isMissingRotationColumns(error)) throw error;
          return await db.update(authSessions).set(base as any).where(where);
        }
      });

      // res null = tabel belum ada (diabaikan). Jika ada tapi tak ada baris
      // ter-update (affectedRows 0), berarti sesi baru saja dicabut di tengah
      // proses ini.
      const affected = res ? ((res as any)[0]?.affectedRows ?? 0) : null;
      if (affected === 0) {
        throw SessionError.revoked('Sesi telah dicabut');
      }

      await cacheSession({
        ...session,
        refresh_jti_hash: newHash,
        prev_refresh_jti_hash: prevHash,
        prev_jti_expires_at: prevExpiresAt,
        expires_at: nextExpiresAt
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
   * Dipakai saat ganti password, akun ditolak/dinonaktifkan, atau dihapus.
   *
   * Mengembalikan daftar session id yang dicabut agar pemanggil bisa menendang
   * socket yang masih tersambung untuk sesi-sesi itu.
   */
  static async revokeAllByUser(
    userType: AuthUserType,
    userId: string,
    exceptSessionId?: string,
    reason = 'revoked_by_admin'
  ): Promise<string[]> {
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

    if (sessionIds.length === 0) return [];

    // Batch revoke di database
    await tolerateMissingTable(() =>
      db
        .update(authSessions)
        .set({ revokedAt, revokeReason: reason, updatedAt: revokedAt } as any)
        .where(and(inArray(authSessions.id, sessionIds), isNull(authSessions.revokedAt)))
    );

    // Hapus cache Redis untuk semua session yang di-revoke
    for (const sid of sessionIds) {
      await redis.del(sessionKey(sid));
    }
    return sessionIds;
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
