import * as argon2 from 'argon2';
import { db } from '../../../lib/db';
import { staffUsers } from '../../../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { revokeAccountSessions } from '../../../core/auth/session-revocation';

export class PasswordService {
  /**
   * Verifikasi password saat ini milik staff.
   * Mengembalikan true jika cocok, false jika tidak.
   */
  static async verifyCurrentPassword(staffId: string, currentPassword: string): Promise<boolean> {
    const [staff] = await db
      .select({ passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, staffId), isNull(staffUsers.deletedAt)))
      .limit(1);

    if (!staff || !staff.passwordHash) throw new Error('Akun tidak memiliki password');

    return argon2.verify(staff.passwordHash, currentPassword);
  }

  /**
   * Update password_hash staff di database.
   */
  static async updatePassword(staffId: string, newPassword: string): Promise<void> {
    const newHash = await argon2.hash(newPassword);

    await db
      .update(staffUsers)
      .set({ passwordHash: newHash })
      .where(and(eq(staffUsers.id, staffId), isNull(staffUsers.deletedAt)));
  }

  /**
   * Invalidasi semua session lain milik staff (kecuali session saat ini).
   * Dipanggil setelah password berhasil diubah.
   */
  static async invalidateOtherSessions(staffId: string, exceptSessionId?: string): Promise<void> {
    // Lewat helper terpusat agar alasannya tercatat benar dan socket perangkat
    // lain ikut ditendang — sesi saat ini (exceptSessionId) TIDAK disentuh.
    await revokeAccountSessions({
      userType: 'staff',
      userId: staffId,
      reason: 'password_changed',
      exceptSessionId
    });
  }
}
