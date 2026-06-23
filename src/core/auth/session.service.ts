import { createHash } from 'node:crypto';
import { redis } from '../../lib/redis';
import { supabase } from '../../lib/supabase';
import { AuthRequestMetadata, AuthUserType } from './security.service';

const REFRESH_TTL_SECONDS = Number(process.env.JWT_REFRESH_TTL_SECONDS || 7 * 24 * 60 * 60);
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

const remainingTtl = (expiresAt: string) =>
  Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));

const cacheSession = async (session: SessionRecord) => {
  await redis.setex(sessionKey(session.id), remainingTtl(session.expires_at), JSON.stringify(session));
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

  const { data, error } = await supabase
    .from('auth_sessions' as any)
    .select('id, user_type, user_id, refresh_jti_hash, expires_at, revoked_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    if (isMissingSessionTable(error)) return null;
    throw new Error(`Gagal membaca auth session: ${error.message}`);
  }
  if (!data) return null;

  const session = data as SessionRecord;
  await cacheSession(session);
  return session;
};

export class AuthSessionService {
  static getRefreshTtlSeconds() {
    return REFRESH_TTL_SECONDS;
  }

  static async create(
    userType: AuthUserType,
    userId: string,
    refreshJti: string,
    metadata: AuthRequestMetadata
  ) {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();
    const session: SessionRecord = {
      id,
      user_type: userType,
      user_id: userId,
      refresh_jti_hash: hashJti(refreshJti),
      expires_at: expiresAt,
      revoked_at: null
    };

    const { error } = await supabase.from('auth_sessions' as any).insert({
      ...session,
      user_agent: metadata.userAgent,
      ip_hash: metadata.ipHash,
      last_used_at: new Date().toISOString()
    });

    if (error && !isMissingSessionTable(error)) {
      throw new Error(`Gagal membuat auth session: ${error.message}`);
    }

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
      session.revoked_at ||
      new Date(session.expires_at).getTime() <= Date.now()
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
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('auth_sessions' as any)
        .update({
          refresh_jti_hash: newHash,
          last_used_at: now,
          updated_at: now
        })
        .eq('id', sessionId)
        .eq('refresh_jti_hash', currentHash)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle();

      if (error && !isMissingSessionTable(error)) {
        throw new Error(`Gagal merotasi refresh token: ${error.message}`);
      }
      if (!error && !data) {
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
    const revokedAt = new Date().toISOString();

    // Ambil semua session aktif untuk user ini
    const { data: sessions, error: fetchError } = await supabase
      .from('auth_sessions' as any)
      .select('id')
      .eq('user_type', userType)
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (fetchError && !isMissingSessionTable(fetchError)) {
      throw new Error(`Gagal mengambil daftar session: ${fetchError.message}`);
    }

    const sessionIds = (sessions ?? [])
      .map((s: any) => s.id as string)
      .filter((id: string) => id !== exceptSessionId);

    if (sessionIds.length === 0) return;

    // Batch revoke di database
    const { error: updateError } = await supabase
      .from('auth_sessions' as any)
      .update({
        revoked_at: revokedAt,
        revoke_reason: 'password_changed',
        updated_at: revokedAt
      })
      .in('id', sessionIds)
      .is('revoked_at', null);

    if (updateError && !isMissingSessionTable(updateError)) {
      throw new Error(`Gagal mencabut session: ${updateError.message}`);
    }

    // Hapus cache Redis untuk semua session yang di-revoke
    for (const sid of sessionIds) {
      await redis.del(sessionKey(sid));
    }
  }

  static async revoke(sessionId: string, reason = 'logout') {
    const revokedAt = new Date().toISOString();
    const { error } = await supabase
      .from('auth_sessions' as any)
      .update({
        revoked_at: revokedAt,
        revoke_reason: reason,
        updated_at: revokedAt
      })
      .eq('id', sessionId)
      .is('revoked_at', null);

    if (error && !isMissingSessionTable(error)) {
      throw new Error(`Gagal mencabut auth session: ${error.message}`);
    }
    await redis.del(sessionKey(sessionId));
  }
}
