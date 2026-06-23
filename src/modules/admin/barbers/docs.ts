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
  }
};
