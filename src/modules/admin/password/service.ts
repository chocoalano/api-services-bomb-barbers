import * as argon2 from 'argon2';
import { supabase } from '../../../lib/supabase';
import { AuthSessionService } from '../../../core/auth/session.service';

export class PasswordService {
  /**
   * Verifikasi password saat ini milik staff.
   * Mengembalikan true jika cocok, false jika tidak.
   */
  static async verifyCurrentPassword(staffId: string, currentPassword: string): Promise<boolean> {
    const { data: staff, error } = await supabase
      .from('staff_users')
      .select('password_hash')
      .eq('id', staffId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new Error('Gagal memverifikasi password: ' + error.message);
    if (!staff || !staff.password_hash) throw new Error('Akun tidak memiliki password');

    return argon2.verify(staff.password_hash, currentPassword);
  }

  /**
   * Update password_hash staff di database.
   */
  static async updatePassword(staffId: string, newPassword: string): Promise<void> {
    const newHash = await argon2.hash(newPassword);

    const { error } = await supabase
      .from('staff_users')
      .update({
        password_hash: newHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', staffId)
      .is('deleted_at', null);

    if (error) throw new Error('Gagal memperbarui password: ' + error.message);
  }

  /**
   * Invalidasi semua session lain milik staff (kecuali session saat ini).
   * Dipanggil setelah password berhasil diubah.
   */
  static async invalidateOtherSessions(staffId: string, exceptSessionId?: string): Promise<void> {
    await AuthSessionService.revokeAllByUser('staff', staffId, exceptSessionId);
  }
}
