import { t } from 'elysia';
import {
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  requestExamples
} from '../swagger';

export const passwordDocs = {
  updatePassword: {
    body: t.Object({
      current_password: t.String({
        minLength: 1,
        description: 'Password saat ini yang sedang digunakan oleh staff/admin. Harus cocok dengan password yang tersimpan di database.',
        examples: ['OldPassword123!']
      }),
      new_password: t.String({
        minLength: 8,
        description: 'Password baru yang akan menggantikan password lama. Minimal 8 karakter dan tidak boleh sama dengan password saat ini.',
        examples: ['NewSecurePassword456!']
      })
    }, requestExamples(
      {
        current_password: 'OldPassword123!',
        new_password: 'NewSecurePassword456!'
      },
      {
        current_password: 'OldPassword123!',
        new_password: 'NewSecurePassword456!'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.auth,
      summary: 'Ubah Password Staff/Admin',
      description: 'Memungkinkan staff atau admin yang sedang login untuk mengubah password-nya sendiri. Backend akan memverifikasi `current_password` terlebih dahulu sebelum menerapkan password baru. Setelah password berhasil diubah, semua session di perangkat lain akan otomatis diinvalidasi untuk keamanan. Perubahan password dicatat ke audit log dengan action `CHANGE_PASSWORD`.',
      required: ['current_password', 'new_password'],
      optional: [],
      successMessage: 'Password berhasil diperbarui',
      successData: null,
      errors: [
        {
          status: 400,
          description: 'Password baru terlalu pendek (kurang dari 8 karakter), atau password baru sama dengan password lama.',
          message: 'Password baru minimal 8 karakter'
        },
        ...commonAuthErrors,
        {
          status: 403,
          description: 'Password lama yang dimasukkan tidak cocok dengan password yang tersimpan di database.',
          message: 'Password lama tidak sesuai'
        },
        {
          status: 429,
          description: 'Terlalu banyak percobaan perubahan password dari alamat jaringan yang sama dalam waktu singkat.',
          message: 'Terlalu banyak percobaan'
        }
      ]
    })
  }
};
