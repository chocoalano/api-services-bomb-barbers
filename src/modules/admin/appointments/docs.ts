import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  commonMutationErrors,
  isoDateTimeField,
  requestExamples,
  uuidField
} from '../swagger';

const appointmentExample = {
  id: ADMIN_EXAMPLES.appointmentId,
  branch_id: ADMIN_EXAMPLES.branchId,
  barber_id: ADMIN_EXAMPLES.barberId,
  customer_id: ADMIN_EXAMPLES.customerId,
  source: 'walk_in',
  status: 'in_queue',
  scheduled_at: '2026-06-20T10:30:00.000Z',
  scheduled_end_at: '2026-06-20T11:15:00.000Z',
  travel_buffer_min: 0,
  queue_position: 4,
  checked_in_at: null,
  started_at: null,
  completed_at: null,
  cancellation_reason: null,
  customer_media_urls: [
    'https://api.bombbarbershop.com/public/uploads/reference/style.webp'
  ],
  created_at: '2026-06-20T10:00:00.000Z',
  updated_at: '2026-06-20T10:00:00.000Z'
};

export const appointmentDocs = {
  adminCreateWalkIn: {
    headers: t.Object({
      authorization: t.Optional(t.String()),
      'x-branch-id': t.Optional(t.String()),
      'idempotency-key': t.String({
        minLength: 8,
        maxLength: 128,
        description: 'Kunci unik request walk-in. Retry wajib memakai nilai yang sama.',
        examples: ['walkin-pos-20260620-0004']
      })
    }, { additionalProperties: true }),
    params: t.Object({
      branchId: uuidField('UUID cabang tempat walk-in dicatat.', ADMIN_EXAMPLES.branchId)
    }),
    body: t.Object({
      service_ids: t.Array(
        uuidField('UUID layanan yang dipilih.', ADMIN_EXAMPLES.serviceId),
        {
          minItems: 1,
          uniqueItems: true,
          description: 'Daftar layanan. Minimal satu layanan wajib dipilih.'
        }
      ),
      barber_id: t.Optional(uuidField(
        'UUID barber yang ditugaskan. Hilangkan jika barber belum ditentukan.',
        ADMIN_EXAMPLES.barberId
      )),
      customer_id: t.Optional(uuidField(
        'UUID customer terdaftar. Hilangkan untuk walk-in anonim.',
        ADMIN_EXAMPLES.customerId
      )),
      scheduled_at: t.Optional(isoDateTimeField(
        'Waktu layanan terjadwal. Default adalah waktu request diterima.',
        '2026-06-20T10:30:00.000Z'
      )),
      media_urls: t.Optional(t.Array(
        t.String({
          format: 'uri',
          description: 'URL foto referensi customer.',
          examples: ['https://api.bombbarbershop.com/public/uploads/reference/style.webp']
        }),
        { maxItems: 10 }
      ))
    }, requestExamples(
      {
        service_ids: [ADMIN_EXAMPLES.serviceId]
      },
      {
        service_ids: [ADMIN_EXAMPLES.serviceId],
        barber_id: ADMIN_EXAMPLES.barberId,
        customer_id: ADMIN_EXAMPLES.customerId,
        scheduled_at: '2026-06-20T10:30:00.000Z',
        media_urls: ['https://api.bombbarbershop.com/public/uploads/reference/style.webp']
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Catat Appointment Walk-in',
      description: 'Membuat appointment walk-in secara atomik pada tabel appointments yang sama dengan booking online. Source otomatis walk_in dan status awal in_queue. Validasi cabang, barber, harga, jam operasional, cuti, overlap jadwal, queue position, snapshot layanan, dan idempotency dilakukan dalam satu transaksi PostgreSQL.',
      required: ['path branchId', 'header Idempotency-Key', 'service_ids', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: ['barber_id', 'customer_id', 'scheduled_at', 'media_urls'],
      successStatus: 201,
      successMessage: 'Walk-in berhasil dicatat',
      successData: appointmentExample,
      errors: [
        ...commonMutationErrors,
        {
          status: 409,
          description: 'Slot barber sudah terisi, barber sedang time-off, atau Idempotency-Key telah digunakan untuk payload berbeda.',
          message: 'Barber sudah memiliki appointment yang overlap pada jadwal tersebut'
        }
      ]
    })
  },
  adminGetQueue: {
    params: t.Object({
      branchId: uuidField('UUID cabang yang antreannya ingin dilihat.', ADMIN_EXAMPLES.branchId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Lihat Antrean Cabang',
      description: 'Mengambil appointment aktif berstatus pending, confirmed, in_queue, atau in_service dan mengurutkannya berdasarkan queue_position.',
      required: ['path branchId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successMessage: 'Daftar antrean cabang',
      successData: [
        {
          ...appointmentExample,
          barbers: { display_name: 'Budi Santoso' },
          customers: { full_name: 'Andi Customer' }
        }
      ],
      errors: commonMutationErrors
    })
  },
  adminUpdateStatus: {
    params: t.Object({
      id: uuidField('UUID appointment yang statusnya akan diubah.', ADMIN_EXAMPLES.appointmentId)
    }),
    body: t.Object({
      status: t.UnionEnum([
        'pending',
        'confirmed',
        'in_queue',
        'in_service',
        'completed',
        'cancelled',
        'no_show'
      ], {
        description: 'Status appointment baru.',
        examples: ['in_service']
      }),
      cancellation_reason: t.Optional(t.String({
        maxLength: 1000,
        description: 'Alasan pembatalan atau no-show. Disarankan saat status cancelled/no_show.',
        examples: ['Customer tidak hadir sampai batas waktu.']
      })),
      reason: t.Optional(t.String({
        minLength: 1,
        maxLength: 1000,
        description: 'Alasan transisi yang dicatat ke appointment_events. Jika kosong, backend membuat alasan yang eksplisit.',
        examples: ['Order dikonfirmasi setelah verifikasi melalui telepon.']
      }))
    }, requestExamples(
      { status: 'in_service' },
      {
        status: 'cancelled',
        cancellation_reason: 'Customer meminta pembatalan di kasir.'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Ubah Status Appointment',
      description: 'Mengubah status appointment secara manual oleh admin cabang dan menyiarkan perubahan melalui Socket.IO.',
      required: ['path id', 'status', 'Authorization: Bearer <access_token>', 'scope cabang appointment'],
      optional: ['reason', 'cancellation_reason (alias legacy untuk cancelled/no_show)'],
      successMessage: 'Status berhasil diperbarui',
      successData: { ...appointmentExample, status: 'in_service', started_at: '2026-06-20T10:35:00.000Z' },
      errors: commonMutationErrors
    })
  },

  adminReassignBarber: {
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
      successData: { ...appointmentExample, barber_id: ADMIN_EXAMPLES.barberId },
      errors: [
        ...commonAuthErrors,
        { status: 409, description: 'Barber baru sudah memiliki appointment yang overlap.', message: 'Barber baru sudah memiliki appointment yang overlap pada jadwal ini' }
      ]
    })
  },

  adminUpdateDestination: {
    params: t.Object({
      id: uuidField('UUID appointment home_service yang lokasi tujuannya akan diperbarui.', ADMIN_EXAMPLES.appointmentId)
    }),
    body: t.Object({
      destination_latitude: t.Numeric({
        minimum: -90,
        maximum: 90,
        description: 'Latitude lokasi tujuan baru. Tidak boleh null atau 0.',
        examples: [-6.2277]
      }),
      destination_longitude: t.Numeric({
        minimum: -180,
        maximum: 180,
        description: 'Longitude lokasi tujuan baru. Tidak boleh null atau 0.',
        examples: [106.8099]
      })
    }, {
      examples: [
        { destination_latitude: -6.2277, destination_longitude: 106.8099 }
      ]
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Perbarui Lokasi Tujuan Appointment (Admin)',
      description: 'Mengubah destination_latitude dan destination_longitude pada appointment home_service. Admin dapat mengubah lokasi selama status masih pending, confirmed, in_queue, atau in_service. Perubahan dicatat di audit log. Hanya berlaku untuk appointment home_service.',
      required: ['path id', 'destination_latitude', 'destination_longitude', 'Authorization: Bearer <access_token>', 'scope cabang appointment'],
      optional: [],
      successMessage: 'Lokasi tujuan berhasil diperbarui',
      successData: {
        ...appointmentExample,
        destination_latitude: -6.2277,
        destination_longitude: 106.8099,
        updated_at: '2026-06-20T09:00:00.000Z'
      },
      errors: [
        ...commonAuthErrors,
        {
          status: 400,
          description: 'Koordinat null, 0, atau di luar rentang valid.',
          message: 'Titik potong/lokasi harus diisi'
        },
        {
          status: 400,
          description: 'Appointment bukan home_service atau status sudah completed/cancelled/no_show.',
          message: 'Hanya appointment home_service yang dapat mengubah lokasi tujuan'
        },
        {
          status: 404,
          description: 'Appointment tidak ditemukan.',
          message: 'Appointment tidak ditemukan'
        }
      ]
    })
  }
};
