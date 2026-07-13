import { t } from 'elysia';
import { ADMIN_EXAMPLES, ADMIN_TAGS, adminDetail, commonAuthErrors, isoDateField, uuidField } from '../swagger';

const barberItem = {
  id: ADMIN_EXAMPLES.barberId,
  display_name: 'Budi Santoso',
  live_status: 'available',
  bio: null,
  rating_avg: 4.8,
  rating_count: 32,
  active_appointment_count: 2,
  staff_users: { full_name: 'Budi Santoso', phone: '62811000001' }
};

export const adminBarbersDocs = {
  listBarbers: {
    params: t.Object({ branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId) }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Daftar Barber Cabang dengan Live Status',
      description: 'Mengambil semua barber aktif di cabang beserta status live dari Redis (fallback ke DB) dan jumlah appointment aktif saat ini.',
      required: ['path branchId', 'Authorization: Bearer <access_token>', 'permission manage_appointment', 'scope cabang'],
      optional: [],
      successMessage: 'Daftar barber cabang',
      successData: [barberItem],
      errors: commonAuthErrors
    })
  },

  getSchedule: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId),
      barberId: uuidField('UUID barber.', ADMIN_EXAMPLES.barberId)
    }),
    query: t.Object({
      date: t.Optional(t.String({
        format: 'date',
        description: 'Tanggal kalender format YYYY-MM-DD (UTC). Default: hari ini.',
        examples: ['2026-06-22']
      }))
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Kalender Jadwal Barber',
      description: 'Mengambil semua appointment barber untuk tanggal tertentu, diurutkan berdasarkan waktu mulai. Appointment cancelled dikecualikan.',
      required: ['path branchId', 'path barberId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: ['query date (default: hari ini UTC)'],
      successMessage: 'Jadwal barber',
      successData: {
        barber: { id: ADMIN_EXAMPLES.barberId, display_name: 'Budi Santoso', live_status: 'available' },
        date: '2026-06-22',
        appointments: [
          {
            id: ADMIN_EXAMPLES.appointmentId,
            status: 'in_queue',
            source: 'walk_in',
            scheduled_at: '2026-06-22T10:00:00.000Z',
            schedule_block_start_at: '2026-06-22T10:00:00.000Z',
            schedule_block_end_at: '2026-06-22T10:45:00.000Z',
            queue_position: 2,
            customers: { id: ADMIN_EXAMPLES.customerId, full_name: 'Fajar Customer', phone: null },
            appointment_services: [{ services: { name: 'Classic Cut', default_duration_min: 45 } }]
          }
        ]
      },
      errors: commonAuthErrors
    })
  },

  setStatus: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId),
      barberId: uuidField('UUID barber.', ADMIN_EXAMPLES.barberId)
    }),
    body: t.Object({
      status: t.UnionEnum(['available', 'serving', 'on_break', 'offline'], {
        description: 'Status kehadiran barber yang akan di-set oleh admin.',
        examples: ['available']
      })
    }, { examples: [{ status: 'available' }, { status: 'offline' }] }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Override Status Barber (Admin)',
      description: 'Admin cabang atau HQ dapat mengubah status online/offline barber secara manual. Perubahan ditulis ke DB dan Redis secara sinkron.',
      required: ['path branchId', 'path barberId', 'status', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successMessage: 'Status barber berhasil diubah',
      successData: { barber_id: ADMIN_EXAMPLES.barberId, status: 'offline' },
      errors: commonAuthErrors
    })
  },

  reassignBarber: {
    params: t.Object({ id: uuidField('UUID appointment yang akan di-reassign.', ADMIN_EXAMPLES.appointmentId) }),
    body: t.Object({
      barber_id: uuidField('UUID barber baru yang akan ditugaskan.', ADMIN_EXAMPLES.barberId)
    }, { examples: [{ barber_id: ADMIN_EXAMPLES.barberId }] }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Reassign Barber Appointment',
      description: 'Mengganti barber yang ditugaskan pada appointment aktif. Barber baru harus terdaftar di cabang yang sama. Gagal dengan 409 jika jadwal barber baru overlap.',
      required: ['path id', 'barber_id', 'Authorization: Bearer <access_token>', 'scope cabang appointment'],
      optional: [],
      successMessage: 'Barber berhasil direassign',
      successData: { id: ADMIN_EXAMPLES.appointmentId, barber_id: ADMIN_EXAMPLES.barberId, status: 'in_queue' },
      errors: [
        ...commonAuthErrors,
        { status: 409, description: 'Barber baru sudah memiliki appointment yang overlap.', message: 'Jadwal barber baru bentrok' }
      ]
    })
  },

  adminList: {
    query: t.Object({
      page: t.Optional(t.Integer({ minimum: 1, default: 1, description: 'Nomor halaman (1-based).' })),
      per_page: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20, description: 'Baris per halaman (maks 100).' })),
      branch_id: t.Optional(uuidField('Filter cabang tertentu (dalam scope peran).', ADMIN_EXAMPLES.branchId)),
      live_status: t.Optional(t.String({ description: 'Status live dipisah koma: available,serving,on_break,offline.', examples: ['available,serving'] })),
      q: t.Optional(t.String({ description: 'Pencarian nama tampilan barber.', examples: ['Budi'] })),
      sort: t.Optional(t.String({ description: 'Kolom urut: display_name | rating_avg | rating_count | created_at.', examples: ['display_name'] })),
      order: t.Optional(t.String({ description: 'Arah urut: asc | desc.', examples: ['asc'] }))
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Daftar Barber (Server-side, Role-scoped)',
      description: 'Daftar barber lintas cabang dengan pagination server-side, join staff & cabang, serta agregat appointment (order aktif & total selesai). Cakupan per peran: super_admin melihat semua cabang; branch_admin hanya barber di cabangnya.',
      required: ['Authorization: Bearer <access_token>', 'permission manage_appointment'],
      optional: ['page', 'per_page', 'branch_id', 'live_status', 'q', 'sort', 'order'],
      successMessage: 'Daftar barber',
      successData: [
        {
          id: ADMIN_EXAMPLES.barberId,
          display_name: 'Budi Santoso',
          live_status: 'available',
          rating_avg: 4.8,
          rating_count: 32,
          branch_id: ADMIN_EXAMPLES.branchId,
          staff: { full_name: 'Budi Santoso', phone: '62811000001', email: 'budi@bomb.com' },
          branches: { id: ADMIN_EXAMPLES.branchId, name: 'Bomb Barbershop Kedoya' },
          stats: { active_appointments: 2, completed_appointments: 148 }
        }
      ],
      errors: commonAuthErrors
    })
  },

  adminStats: {
    query: t.Object({
      branch_id: t.Optional(uuidField('Filter cabang tertentu (opsional).', ADMIN_EXAMPLES.branchId))
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Statistik Barber (Role-scoped)',
      description: 'Ringkasan barber sesuai cakupan peran: total, available, serving, on_break, offline, dan rata-rata rating.',
      required: ['Authorization: Bearer <access_token>', 'permission manage_appointment'],
      optional: ['branch_id'],
      successMessage: 'Statistik barber',
      successData: { total: 186, available: 74, serving: 21, on_break: 8, offline: 83, avg_rating: 4.7 },
      errors: commonAuthErrors
    })
  }
};
