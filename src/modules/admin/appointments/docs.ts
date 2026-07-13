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
      description: 'Membuat appointment walk-in secara atomik pada tabel appointments yang sama dengan booking online. Source otomatis walk_in dan status awal in_queue. Validasi cabang, barber, harga, jam operasional, cuti, overlap jadwal, queue position, snapshot layanan, dan idempotency dilakukan dalam satu transaksi database.',
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
  },

  adminList: {
    query: t.Object({
      page: t.Optional(t.Integer({ minimum: 1, default: 1, description: 'Nomor halaman (1-based).' })),
      per_page: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20, description: 'Jumlah baris per halaman (maks 100).' })),
      branch_id: t.Optional(uuidField('Filter cabang tertentu. Super admin: cabang mana pun; branch admin: harus dalam scope.', ADMIN_EXAMPLES.branchId)),
      status: t.Optional(t.String({ description: 'Daftar status dipisah koma: pending,confirmed,in_queue,in_service,completed,cancelled,no_show.', examples: ['pending,confirmed,in_queue'] })),
      source: t.Optional(t.String({ description: 'Sumber dipisah koma: online_booking,walk_in.', examples: ['walk_in'] })),
      fulfillment_type: t.Optional(t.String({ description: 'Jenis layanan dipisah koma: in_store,home_service.', examples: ['home_service'] })),
      payment_status: t.Optional(t.String({ description: 'Status pembayaran dipisah koma: pending,paid,failed,expired,refunded,partially_refunded.', examples: ['paid'] })),
      barber_id: t.Optional(uuidField('Filter barber tertentu.', ADMIN_EXAMPLES.barberId)),
      q: t.Optional(t.String({ description: 'Pencarian bebas pada nama/telepon/email customer.', examples: ['Andi'] })),
      date_field: t.Optional(t.String({ description: 'Kolom tanggal untuk filter rentang: scheduled_at (default) atau created_at.', examples: ['scheduled_at'] })),
      date_from: t.Optional(t.String({ description: 'Batas awal rentang (YYYY-MM-DD atau ISO). Tanggal murni memakai batas hari Asia/Jakarta.', examples: ['2026-06-20'] })),
      date_to: t.Optional(t.String({ description: 'Batas akhir rentang (inklusif untuk tanggal murni).', examples: ['2026-06-20'] })),
      sort: t.Optional(t.String({ description: 'Kolom urut: scheduled_at,created_at,status,queue_position,completed_at.', examples: ['scheduled_at'] })),
      order: t.Optional(t.String({ description: 'Arah urut: asc atau desc (default desc).', examples: ['desc'] }))
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Daftar Appointment (Server-side, Role-scoped)',
      description: 'Mengambil daftar appointment dengan pagination server-side, filter kompleks, dan join lintas tabel (branches, barbers, customers, appointment_services→services, payments). Cakupan cabang ditentukan otomatis dari peran: super_admin/HQ melihat seluruh cabang, branch_admin hanya cabang miliknya. Meta berisi total, page, per_page, total_pages, has_prev, has_next.',
      required: ['Authorization: Bearer <access_token>', 'permission manage_appointment'],
      optional: ['page', 'per_page', 'branch_id', 'status', 'source', 'fulfillment_type', 'payment_status', 'barber_id', 'q', 'date_from', 'date_to', 'sort', 'order'],
      successMessage: 'Daftar appointment',
      successData: [
        {
          ...appointmentExample,
          branches: { id: ADMIN_EXAMPLES.branchId, name: 'Bomb Barbershop Kedoya' },
          barbers: { id: ADMIN_EXAMPLES.barberId, display_name: 'Budi Santoso', live_status: 'online' },
          customers: { id: ADMIN_EXAMPLES.customerId, full_name: 'Andi Customer', phone: '081234567890', email: 'andi@example.com' },
          appointment_services: [{ id: ADMIN_EXAMPLES.serviceId, price_amount: 75000, duration_min: 45, services: { id: ADMIN_EXAMPLES.serviceId, name: 'Haircut + Wash' } }],
          payments: [{ total_amount: 75000, service_amount: 75000, product_amount: 0, tip_amount: 0, discount_amount: 0, method: 'qris', status: 'paid', paid_at: '2026-06-20T11:20:00.000Z' }]
        }
      ],
      errors: commonAuthErrors
    })
  },

  adminStats: {
    query: t.Object({
      branch_id: t.Optional(uuidField('Filter cabang tertentu (opsional).', ADMIN_EXAMPLES.branchId)),
      date_field: t.Optional(t.String({ description: 'Kolom tanggal: scheduled_at (default) atau created_at.', examples: ['scheduled_at'] })),
      date_from: t.Optional(t.String({ description: 'Batas awal rentang. Default: hari berjalan Asia/Jakarta.', examples: ['2026-06-20'] })),
      date_to: t.Optional(t.String({ description: 'Batas akhir rentang (inklusif untuk tanggal murni).', examples: ['2026-06-20'] }))
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.appointments,
      summary: 'Statistik Appointment (Role-scoped)',
      description: 'Menghitung ringkasan appointment (total, aktif, in_service, selesai, batal, no_show, walk_in, online, home_service) sesuai cakupan cabang peran. Tanpa rentang tanggal, default ke hari berjalan Asia/Jakarta.',
      required: ['Authorization: Bearer <access_token>', 'permission manage_appointment'],
      optional: ['branch_id', 'date_from', 'date_to'],
      successMessage: 'Statistik appointment',
      successData: {
        total: 128, active: 41, in_service: 18, completed: 63,
        cancelled: 5, no_show: 1, walk_in: 47, online_booking: 81, home_service: 12
      },
      errors: commonAuthErrors
    })
  }
};
