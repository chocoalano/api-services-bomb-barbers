import { AuthSessionService } from './session.service';
import { SessionErrorCode, type SessionErrorCodeValue } from './session-errors';
import { invalidateRbacCache } from '../../middleware/rbac';
import { disconnectRevokedSessions } from '../../lib/socket';
import { logger } from '../../lib/logger';
import type { AuthUserType } from './security.service';

/**
 * Alasan pencabutan sesi — dipakai untuk kolom `revoke_reason` sekaligus
 * menentukan kode yang dikirim ke aplikasi.
 */
export type RevocationReason =
  | 'account_rejected'
  | 'account_deleted'
  | 'account_suspended'
  | 'password_changed'
  | 'revoked_by_admin';

const CODE_BY_REASON: Record<RevocationReason, SessionErrorCodeValue> = {
  account_rejected: SessionErrorCode.ACCOUNT_REJECTED,
  account_deleted: SessionErrorCode.ACCOUNT_REJECTED,
  account_suspended: SessionErrorCode.ACCOUNT_SUSPENDED,
  password_changed: SessionErrorCode.SESSION_REVOKED,
  revoked_by_admin: SessionErrorCode.SESSION_REVOKED
};

const MESSAGE_BY_REASON: Record<RevocationReason, string> = {
  account_rejected: 'Akun Anda tidak lagi disetujui admin.',
  account_deleted: 'Akun Anda sudah dihapus admin.',
  account_suspended: 'Akun Anda dinonaktifkan. Hubungi admin.',
  password_changed: 'Kata sandi berubah. Silakan masuk kembali.',
  revoked_by_admin: 'Sesi Anda dicabut admin. Silakan masuk kembali.'
};

/**
 * Cabut SELURUH sesi milik satu akun, lalu pastikan pencabutan itu benar-benar
 * terasa: cache RBAC dibuang dan socket yang masih tersambung ditendang.
 *
 * Ini titik tunggal untuk semua perubahan status akun (tolak kepster, hapus,
 * nonaktifkan, ganti password). Sebelum G2 diperbaiki, `setBarberApproval`
 * hanya meng-UPDATE kolom dan sesi kepster yang ditolak jalan terus — inilah
 * pengganti kebiasaan itu.
 *
 * @param exceptSessionId sesi yang TIDAK ikut dicabut (mis. sesi admin yang
 *        sedang melakukan aksinya, atau perangkat yang barusan ganti password).
 */
export const revokeAccountSessions = async (params: {
  userType: AuthUserType;
  userId: string;
  reason: RevocationReason;
  exceptSessionId?: string;
}): Promise<string[]> => {
  const { userType, userId, reason, exceptSessionId } = params;

  const revokedIds = await AuthSessionService.revokeAllByUser(
    userType,
    userId,
    exceptSessionId,
    reason
  );

  if (userType === 'staff') {
    // Tanpa ini, profil RBAC yang sudah ter-cache masih meloloskan akun tersebut
    // sampai satu menit ke depan.
    await invalidateRbacCache(userId);
  }

  logger.info(
    { userType, userId, reason, revoked: revokedIds.length },
    '[SessionRevocation] Sesi akun dicabut'
  );

  if (revokedIds.length > 0) {
    await disconnectRevokedSessions({
      userType: userType === 'customer' ? 'customer' : 'staff',
      userId,
      sessionIds: revokedIds,
      code: CODE_BY_REASON[reason],
      message: MESSAGE_BY_REASON[reason]
    });
  }

  return revokedIds;
};
