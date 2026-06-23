import { t } from 'elysia';
import {
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  requestExamples
} from '../swagger';

const notificationSettingsExample = {
  new_appointment: true,
  appointment_reminder: true,
  appointment_cancelled: true,
  whatsapp: false,
  email: true,
  daily_summary: true,
  weekly_report: false
};

const notificationSettingsSchema = t.Object({
  new_appointment: t.Boolean({
    default: true,
    description: 'Aktifkan notifikasi saat ada appointment baru yang masuk ke sistem. Berguna untuk admin cabang yang ingin mengetahui booking terbaru secara real-time.'
  }),
  appointment_reminder: t.Boolean({
    default: true,
    description: 'Aktifkan pengingat otomatis 1 jam sebelum waktu appointment dimulai. Membantu admin mempersiapkan barber dan peralatan yang dibutuhkan.'
  }),
  appointment_cancelled: t.Boolean({
    default: true,
    description: 'Aktifkan notifikasi saat ada appointment yang dibatalkan oleh pelanggan atau sistem. Berguna untuk mengelola jadwal barber secara efisien.'
  }),
  whatsapp: t.Boolean({
    default: false,
    description: 'Aktifkan pengiriman notifikasi melalui channel WhatsApp. Secara default nonaktif, perlu diaktifkan secara manual oleh admin.'
  }),
  email: t.Boolean({
    default: true,
    description: 'Aktifkan pengiriman notifikasi melalui channel Email. Secara default aktif untuk semua admin.'
  }),
  daily_summary: t.Boolean({
    default: true,
    description: 'Aktifkan laporan ringkasan harian yang dikirim setiap akhir hari operasional. Berisi rangkuman jumlah appointment, pendapatan, dan statistik penting lainnya.'
  }),
  weekly_report: t.Boolean({
    default: false,
    description: 'Aktifkan laporan performa mingguan yang dikirim setiap awal minggu. Berisi analisis tren, perbandingan performa, dan rekomendasi perbaikan.'
  })
});

export const notificationSettingsDocs = {
  getSettings: {
    detail: adminDetail({
      tag: ADMIN_TAGS.settings,
      summary: 'Ambil Pengaturan Notifikasi',
      description: 'Mengambil preferensi pengaturan notifikasi milik admin yang sedang login. Setiap admin memiliki konfigurasi notifikasi masing-masing yang tersimpan di database. Jika admin belum pernah mengatur preferensinya, endpoint ini akan mengembalikan nilai default: semua aktif kecuali `whatsapp` dan `weekly_report` yang default nonaktif.',
      required: ['Authorization: Bearer <access_token>'],
      optional: [],
      successMessage: 'Pengaturan notifikasi',
      successData: notificationSettingsExample,
      errors: [...commonAuthErrors]
    })
  },
  updateSettings: {
    body: notificationSettingsSchema,
    detail: adminDetail({
      tag: ADMIN_TAGS.settings,
      summary: 'Perbarui Pengaturan Notifikasi',
      description: 'Menyimpan preferensi pengaturan notifikasi untuk admin yang sedang login. Setiap field bersifat opsional — field yang tidak disertakan dalam body request akan tetap menggunakan nilai sebelumnya atau default. Perubahan langsung berlaku dan disimpan secara permanen ke database.',
      required: [],
      optional: ['new_appointment', 'appointment_reminder', 'appointment_cancelled', 'whatsapp', 'email', 'daily_summary', 'weekly_report'],
      successMessage: 'Pengaturan notifikasi berhasil diperbarui',
      successData: { ...notificationSettingsExample, appointment_cancelled: false, whatsapp: true },
      errors: [
        {
          status: 400,
          description: 'Body request tidak valid atau mengandung tipe data yang salah (bukan boolean).',
          message: 'Validasi gagal'
        },
        ...commonAuthErrors
      ]
    })
  }
};
