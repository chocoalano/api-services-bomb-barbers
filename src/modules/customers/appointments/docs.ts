import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerAuthError,
  customerDateTimeField,
  customerDetail,
  customerProtectedErrors,
  customerUuidField,
  customerValidationError
} from '../swagger';

const appointmentExample = {
  id: CUSTOMER_EXAMPLES.appointmentId,
  branch_id: CUSTOMER_EXAMPLES.branchId,
  barber_id: CUSTOMER_EXAMPLES.barberId,
  customer_id: CUSTOMER_EXAMPLES.customerId,
  source: 'online_booking',
  status: 'confirmed',
  ongoing_status: 'waiting',
  scheduled_at: '2026-06-25T03:00:00.000Z',
  queue_position: 2,
  checked_in_at: null,
  started_at: null,
  completed_at: null,
  cancellation_reason: null,
  customer_media_urls: [CUSTOMER_EXAMPLES.imageUrl],
  total_service_amount: 85000,
  total_price: 85000,
  total_duration_min: 45,
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:05:00.000Z',
  branch: {
    id: CUSTOMER_EXAMPLES.branchId,
    name: 'Bomb Barbershop Senopati',
    address: 'Jl. Senopati No. 88, Jakarta Selatan',
    latitude: -6.2308,
    longitude: 106.8021,
    location: {
      lat: -6.2308,
      lng: 106.8021
    }
  },
  barber: {
    id: CUSTOMER_EXAMPLES.barberId,
    full_name: 'Andi Barber',
    display_name: 'Andi Barber',
    rating_avg: 4.85,
    rating_count: 124,
    latitude: -6.2308,
    longitude: 106.8021,
    location: {
      lat: -6.2308,
      lng: 106.8021
    }
  },
  location: {
    lat: -6.2308,
    lng: 106.8021
  },
  tracking_initial_location: {
    lat: -6.2308,
    lng: 106.8021
  },
  barber_lat: -6.2308,
  barber_lng: 106.8021,
  barberLat: -6.2308,
  barberLng: 106.8021,
  services: [
    {
      id: CUSTOMER_EXAMPLES.serviceId,
      name: 'Haircut',
      description: 'Potong rambut, konsultasi gaya, keramas, dan styling.',
      image_url: 'https://api.bombbarbershop.com/public/uploads/service/premium-haircut.webp',
      price: 85000,
      price_amount: 85000,
      duration_min: 45
    }
  ],
  items: [
    {
      id: CUSTOMER_EXAMPLES.serviceId,
      item_type: 'service',
      service_id: CUSTOMER_EXAMPLES.serviceId,
      name: 'Haircut',
      description: 'Potong rambut, konsultasi gaya, keramas, dan styling.',
      image_url: 'https://api.bombbarbershop.com/public/uploads/service/premium-haircut.webp',
      quantity: 1,
      unit_price: 85000,
      price: 85000,
      total_price: 85000,
      duration_min: 45
    }
  ]
};

const createdAppointmentExample = {
  id: CUSTOMER_EXAMPLES.appointmentId,
  branch_id: CUSTOMER_EXAMPLES.branchId,
  barber_id: CUSTOMER_EXAMPLES.barberId,
  customer_id: CUSTOMER_EXAMPLES.customerId,
  source: 'online_booking',
  status: 'pending',
  scheduled_at: '2026-06-25T03:00:00.000Z',
  scheduled_end_at: '2026-06-25T03:45:00.000Z',
  travel_buffer_min: 0,
  queue_position: 2,
  customer_media_urls: [CUSTOMER_EXAMPLES.imageUrl],
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:00:00.000Z'
};

export const appointmentDocs = {
  customerCreateAppointment: {
    headers: t.Object({
      authorization: t.Optional(t.String()),
      'idempotency-key': t.String({
        minLength: 8,
        maxLength: 128,
        description: 'Kunci unik request booking. Gunakan nilai yang sama ketika retry agar appointment tidak dibuat ganda.',
        examples: ['booking-mobile-20260625-001']
      })
    }, { additionalProperties: true }),
    body: t.Object({
      branch_id: customerUuidField(
        'UUID cabang tempat layanan akan dilakukan.',
        CUSTOMER_EXAMPLES.branchId
      ),
      barber_id: t.Optional(customerUuidField(
        'UUID barber pilihan. Jika tidak dikirim, appointment dibuat tanpa barber tertentu.',
        CUSTOMER_EXAMPLES.barberId
      )),
      service_ids: t.Array(customerUuidField(
        'UUID layanan yang dipilih customer.',
        CUSTOMER_EXAMPLES.serviceId
      ), {
        minItems: 1,
        description: 'Daftar layanan. Minimal satu UUID layanan wajib dikirim.',
        examples: [[CUSTOMER_EXAMPLES.serviceId, CUSTOMER_EXAMPLES.secondServiceId]]
      }),
      scheduled_at: t.Optional(customerDateTimeField(
        'Jadwal appointment dalam ISO 8601 timestamptz. Jika tidak dikirim, backend menggunakan lima menit setelah request diproses untuk menjaga booking tetap berada di masa depan.',
        '2026-06-25T10:00:00+07:00'
      )),
      fulfillment_type: t.Optional(t.UnionEnum(['in_store', 'home_service'], {
        default: 'in_store',
        description: 'Mode pelayanan. in_store berarti customer datang ke cabang; home_service berarti barber menuju lokasi customer.',
        examples: ['home_service']
      })),
      service_address: t.Optional(t.String({
        minLength: 5,
        description: 'Snapshot alamat tujuan. Wajib untuk home_service.',
        examples: ['Jl. Wijaya I No. 10, Kebayoran Baru, Jakarta Selatan']
      })),
      destination_latitude: t.Optional(t.Numeric({
        minimum: -90,
        maximum: 90,
        description: 'Latitude tujuan customer. Wajib untuk home_service.',
        examples: [-6.2442]
      })),
      destination_longitude: t.Optional(t.Numeric({
        minimum: -180,
        maximum: 180,
        description: 'Longitude tujuan customer. Wajib untuk home_service.',
        examples: [106.8096]
      })),
      location_notes: t.Optional(t.String({
        maxLength: 500,
        description: 'Petunjuk tambahan untuk barber menemukan lokasi customer.',
        examples: ['Rumah pagar hitam, tekan bel sebelah kiri.']
      })),
      media_urls: t.Optional(t.Array(t.String({
        format: 'uri',
        description: 'URL foto referensi hasil upload endpoint media customer.',
        examples: [CUSTOMER_EXAMPLES.imageUrl]
      }), {
        description: 'Daftar URL foto wajah atau referensi gaya rambut.',
        examples: [[CUSTOMER_EXAMPLES.imageUrl]]
      }))
    }, {
      examples: [
        {
          branch_id: CUSTOMER_EXAMPLES.branchId,
          service_ids: [CUSTOMER_EXAMPLES.serviceId]
        },
        {
          branch_id: CUSTOMER_EXAMPLES.branchId,
          barber_id: CUSTOMER_EXAMPLES.barberId,
          service_ids: [CUSTOMER_EXAMPLES.serviceId, CUSTOMER_EXAMPLES.secondServiceId],
          scheduled_at: '2026-06-25T10:00:00+07:00',
          fulfillment_type: 'home_service',
          service_address: 'Jl. Wijaya I No. 10, Kebayoran Baru, Jakarta Selatan',
          destination_latitude: -6.2442,
          destination_longitude: 106.8096,
          location_notes: 'Rumah pagar hitam, tekan bel sebelah kiri.',
          media_urls: [CUSTOMER_EXAMPLES.imageUrl]
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.appointments,
      summary: 'Buat Booking Online',
      description: 'Membuat appointment online secara atomik melalui transaksi PostgreSQL. Backend memvalidasi cabang aktif, barber aktif dan satu cabang, layanan beserta harga efektif, jam operasional, cuti barber, benturan jadwal, queue position, serta idempotency. scheduled_end_at dihitung dari total durasi snapshot layanan. Home service juga memakai travel buffer untuk mencegah jadwal terlalu rapat.',
      required: [
        'Authorization: Bearer <customer_access_token>',
        'header.Idempotency-Key',
        'body.branch_id',
        'body.service_ids (minimal satu UUID)'
      ],
      optional: [
        'body.barber_id (wajib untuk home_service)',
        'body.scheduled_at',
        'body.fulfillment_type',
        'body.service_address (wajib untuk home_service)',
        'body.destination_latitude (wajib untuk home_service)',
        'body.destination_longitude (wajib untuk home_service)',
        'body.location_notes',
        'body.media_urls'
      ],
      successStatus: 201,
      successDescription: 'Appointment dan snapshot layanan berhasil dibuat.',
      successMessage: 'Pemesanan online berhasil dibuat',
      successData: createdAppointmentExample,
      errors: [
        ...customerProtectedErrors,
        {
          status: 409,
          description: 'Slot barber sudah terisi, barber sedang time-off, atau Idempotency-Key telah digunakan untuk payload berbeda.',
          message: 'Barber sudah memiliki appointment yang overlap pada jadwal tersebut'
        }
      ]
    })
  },

  customerGetAppointments: {
    query: t.Object({
      status: t.Optional(t.String({
        description: 'Satu status atau beberapa status dipisahkan koma. Status: pending, confirmed, in_queue, in_service, completed, cancelled, no_show. Alias UI: waiting, in_process, ongoing.',
        examples: ['waiting,in_process']
      })),
      ongoing_only: t.Optional(t.BooleanString({
        description: 'Jika true, hanya mengembalikan pending, confirmed, in_queue, dan in_service.',
        examples: ['true']
      })),
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 100,
        default: 10,
        description: 'Jumlah maksimal appointment per halaman. Default 10, maksimum 100.',
        examples: [10]
      })),
      page: t.Optional(t.Numeric({
        minimum: 1,
        default: 1,
        description: 'Nomor halaman pagination berbasis offset.',
        examples: [1]
      })),
      before: t.Optional(customerDateTimeField(
        'Cursor created_at. Hanya data yang lebih lama dari timestamp ini yang dikembalikan.',
        '2026-06-20T08:00:00.000Z'
      ))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.appointments,
      summary: 'Daftar Appointment Customer',
      description: 'Mengambil appointment milik customer yang sedang login, lengkap dengan cabang, barber, layanan, item tagihan, total harga, total durasi, media referensi, serta lokasi awal tracking. Filter status dan pagination dapat digunakan untuk halaman ongoing maupun riwayat.',
      required: ['Authorization: Bearer <customer_access_token>'],
      optional: ['query.status', 'query.ongoing_only', 'query.limit', 'query.page', 'query.before'],
      successMessage: 'Daftar riwayat pemesanan',
      successData: [appointmentExample],
      errors: [
        customerAuthError,
        customerValidationError
      ]
    })
  },

  customerGetAppointmentDetail: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment milik customer yang sedang login.',
        CUSTOMER_EXAMPLES.appointmentId
      )
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.appointments,
      summary: 'Detail Appointment Customer',
      description: 'Mengambil satu appointment milik customer beserta relasi cabang, barber, layanan, item tagihan, lokasi awal tracking, waktu lifecycle, dan alasan pembatalan bila tersedia.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id'],
      successMessage: 'Detail pemesanan',
      successData: appointmentExample,
      errors: [
        customerAuthError,
        {
          status: 404,
          description: 'Appointment tidak ditemukan atau bukan milik customer.',
          message: 'Pemesanan tidak ditemukan'
        }
      ]
    })
  },

  customerCancelAppointment: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment yang akan dibatalkan.',
        CUSTOMER_EXAMPLES.appointmentId
      )
    }),
    body: t.Object({
      reason: t.String({
        minLength: 1,
        description: 'Alasan pembatalan yang akan disimpan pada cancellation_reason.',
        examples: ['Jadwal saya berubah']
      })
    }, {
      examples: [
        {
          reason: 'Jadwal saya berubah'
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.appointments,
      summary: 'Batalkan Appointment Customer',
      description: 'Membatalkan appointment milik customer selama statusnya belum in_service, completed, atau cancelled. Status berubah menjadi cancelled dan alasan pembatalan disimpan.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id', 'body.reason'],
      successMessage: 'Pemesanan berhasil dibatalkan',
      successData: {
        ...createdAppointmentExample,
        status: 'cancelled',
        cancellation_reason: 'Jadwal saya berubah',
        updated_at: '2026-06-20T08:30:00.000Z'
      },
      errors: [
        customerAuthError,
        {
          status: 400,
          description: 'Appointment bukan milik customer atau statusnya tidak dapat dibatalkan.',
          message: 'Tidak dapat membatalkan pemesanan dengan status in_service'
        }
      ]
    })
  },

  customerUpdateStatus: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment yang statusnya akan diperbarui.',
        CUSTOMER_EXAMPLES.appointmentId
      )
    }),
    body: t.Object({
      status: t.Literal('cancelled', {
        description: 'Customer hanya diizinkan memilih cancelled. confirmed hanya dapat dilakukan barber atau admin.',
        examples: ['cancelled']
      }),
      cancellation_reason: t.Optional(t.String({
        description: 'Alasan pembatalan. Relevan ketika status tujuan adalah cancelled.',
        examples: ['Tidak dapat hadir']
      }))
    }, {
      examples: [
        {
          status: 'cancelled',
          cancellation_reason: 'Tidak dapat hadir'
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.appointments,
      summary: 'Perbarui Status Appointment Customer',
      description: 'Alias kompatibilitas untuk membatalkan appointment milik customer. Customer tidak dapat lagi mengubah pending menjadi confirmed; penerimaan order hanya dapat dilakukan barber atau admin.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id', 'body.status'],
      optional: ['body.cancellation_reason'],
      successMessage: 'Status pemesanan berhasil diperbarui',
      successData: {
        ...createdAppointmentExample,
        status: 'cancelled',
        cancellation_reason: 'Tidak dapat hadir',
        updated_at: '2026-06-20T08:10:00.000Z'
      },
      errors: [
        customerAuthError,
        {
          status: 400,
          description: 'Appointment bukan milik customer, status tidak valid, atau transisi status ditolak.',
          message: 'Pemesanan tidak valid atau bukan milik Anda'
        }
      ]
    })
  },

  customerUpdateDestination: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment home_service yang lokasi tujuannya akan diperbarui.',
        CUSTOMER_EXAMPLES.appointmentId
      )
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
    detail: customerDetail({
      tag: CUSTOMER_TAGS.appointments,
      summary: 'Perbarui Lokasi Tujuan Appointment',
      description: 'Mengubah destination_latitude dan destination_longitude pada appointment home_service milik customer. Hanya dapat dilakukan selama status masih pending, confirmed, atau in_queue. Setelah barber memulai pelayanan (in_service) lokasi tidak lagi dapat diubah.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id', 'body.destination_latitude', 'body.destination_longitude'],
      successMessage: 'Lokasi tujuan berhasil diperbarui',
      successData: {
        ...createdAppointmentExample,
        destination_latitude: -6.2277,
        destination_longitude: 106.8099,
        destination_location: { lat: -6.2277, lng: 106.8099 },
        updated_at: '2026-06-20T09:00:00.000Z'
      },
      errors: [
        customerAuthError,
        customerValidationError,
        {
          status: 400,
          description: 'Koordinat null, 0, atau di luar rentang valid.',
          message: 'Titik potong/lokasi harus diisi'
        },
        {
          status: 400,
          description: 'Appointment bukan home_service atau status sudah in_service/completed.',
          message: 'Hanya appointment home_service yang dapat mengubah lokasi tujuan'
        },
        {
          status: 403,
          description: 'Appointment bukan milik customer pada token.',
          message: 'Appointment bukan milik Anda'
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
