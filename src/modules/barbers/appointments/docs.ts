import { t } from 'elysia';
import {
  BARBER_EXAMPLES,
  BARBER_TAGS,
  barberAuthError,
  barberDetail,
  barberProtectedErrors,
  barberRoleError,
  barberServerError,
  barberUuidField,
  barberValidationError
} from '../swagger';

const appointmentParams = t.Object({
  id: barberUuidField(
    'UUID appointment yang ditugaskan kepada barber.',
    BARBER_EXAMPLES.appointmentId
  )
});

const queueOrderExample = {
  id: BARBER_EXAMPLES.appointmentId,
  customer_name: 'Budi Santoso',
  service_name: 'Haircut + Hair Washing',
  price: 105000,
  distance: '2.4 km',
  eta: '18 menit',
  time: '10:00',
  address: 'Jl. Senopati No. 88, Jakarta Selatan',
  status: 'accepted',
  raw_status: 'confirmed'
};

const appointmentRecordExample = {
  id: BARBER_EXAMPLES.appointmentId,
  branch_id: BARBER_EXAMPLES.branchId,
  barber_id: BARBER_EXAMPLES.barberId,
  customer_id: BARBER_EXAMPLES.customerId,
  source: 'online_booking',
  status: 'confirmed',
  scheduled_at: '2026-06-25T03:00:00.000Z',
  queue_position: 2,
  started_at: null,
  completed_at: null,
  cancellation_reason: null,
  customer_media_urls: [],
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:10:00.000Z'
};

export const appointmentDocs = {
  barberGetQueue: {
    detail: barberDetail({
      tag: BARBER_TAGS.queue,
      summary: 'Antrean dan Order Aktif Barber',
      description: 'Mengambil appointment pending, confirmed, in_queue, dan in_service yang ditugaskan kepada barber pada token. Response sudah diformat untuk dashboard: nama customer, gabungan layanan, snapshot harga, jarak/ETA dari Redis, jam, alamat, status UI, dan status asli database.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Daftar antrean dan order berjalan barber',
      successData: [queueOrderExample],
      errors: [
        barberAuthError,
        barberRoleError,
        {
          status: 400,
          description: 'Profil barber tidak ditemukan atau query antrean gagal.',
          message: 'Profil barber tidak ditemukan'
        },
        barberServerError
      ]
    })
  },

  barberAcceptOrder: {
    params: appointmentParams,
    detail: barberDetail({
      tag: BARBER_TAGS.appointments,
      summary: 'Terima Order',
      description: 'Menerima appointment berstatus pending yang ditugaskan kepada barber. Status database berubah menjadi confirmed dan response menyediakan alias status accepted untuk kebutuhan UI.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      successMessage: 'Order berhasil diterima',
      successData: {
        ...appointmentRecordExample,
        status: 'accepted',
        raw_status: 'confirmed'
      },
      errors: [
        barberAuthError,
        barberRoleError,
        {
          status: 400,
          description: 'Order tidak lagi berstatus pending atau perubahan status gagal.',
          message: 'Pesanan hanya bisa diterima jika statusnya pending'
        }
      ]
    })
  },

  barberPushLocation: {
    params: appointmentParams,
    body: t.Object({
      lat: t.Numeric({
        minimum: -90,
        maximum: 90,
        description: 'Latitude posisi barber saat ini.',
        examples: [-6.2297]
      }),
      lng: t.Numeric({
        minimum: -180,
        maximum: 180,
        description: 'Longitude posisi barber saat ini.',
        examples: [106.7998]
      }),
      accuracy_m: t.Optional(t.Numeric({
        minimum: 0,
        maximum: 1000,
        description: 'Akurasi GPS dalam meter.',
        examples: [8]
      })),
      heading: t.Optional(t.Numeric({
        minimum: 0,
        maximum: 359.999,
        description: 'Arah pergerakan barber dalam derajat.',
        examples: [180]
      })),
      speed_mps: t.Optional(t.Numeric({
        minimum: 0,
        maximum: 100,
        description: 'Kecepatan barber dalam meter per detik. Digunakan sebagai salah satu input ETA fallback.',
        examples: [8]
      })),
      captured_at: t.Optional(t.String({
        format: 'date-time',
        description: 'Waktu koordinat diperoleh dari GPS. Maksimal dua menit sebelum request.',
        examples: ['2026-06-25T02:30:00.000Z']
      })),
      eta_minutes: t.Optional(t.Numeric({
        minimum: 0,
        description: 'Field legacy yang diabaikan. ETA dihitung oleh server.',
        examples: [18]
      }))
    }, {
      examples: [
        {
          lat: -6.2297,
          lng: 106.7998
        },
        {
          lat: -6.2297,
          lng: 106.7998,
          accuracy_m: 8,
          speed_mps: 8,
          captured_at: '2026-06-25T02:30:00.000Z'
        }
      ]
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.tracking,
      summary: 'Kirim Lokasi GPS Barber',
      description: 'Menyimpan koordinat barber di Redis dengan TTL pendek, membaca lokasi customer terbaru, menghitung jarak dan ETA di server melalui routing provider atau fallback Haversine, lalu menyiarkan snapshot resmi melalui Socket.IO. Endpoint hanya tersedia untuk home_service berstatus confirmed atau in_queue dengan sesi tracking aktif.',
      required: [
        'Authorization: Bearer <barber_access_token>',
        'path.id',
        'body.lat',
        'body.lng'
      ],
      optional: ['body.accuracy_m', 'body.heading', 'body.speed_mps', 'body.captured_at', 'body.eta_minutes (legacy/diabaikan)'],
      successMessage: 'Lokasi berhasil diperbarui',
      successData: {
        barber_location: {
          appointment_id: BARBER_EXAMPLES.appointmentId,
          actor_id: BARBER_EXAMPLES.barberId,
          actor_type: 'barber',
          lat: -6.2297,
          lng: 106.7998,
          accuracy_m: 8,
          speed_mps: 8,
          captured_at: '2026-06-25T02:30:00.000Z',
          received_at: '2026-06-25T02:30:01.000Z',
          sequence: 21
        },
        customer_location: {
          appointment_id: BARBER_EXAMPLES.appointmentId,
          actor_type: 'customer',
          lat: -6.2442,
          lng: 106.8096,
          sequence: 14
        },
        route: {
          source: 'routing_provider',
          distance_km: 2.4,
          eta_minutes: 8,
          calculated_at: '2026-06-25T02:30:01.000Z',
          barber_sequence: 21,
          customer_sequence: 14
        }
      },
      errors: [
        barberAuthError,
        barberRoleError,
        barberValidationError,
        {
          status: 400,
          description: 'Appointment bukan home_service, sesi tracking tidak aktif, barber bukan participant resmi, atau status order tidak mengizinkan tracking.',
          message: 'Live location barber hanya tersedia untuk appointment home_service'
        }
      ]
    })
  },

  barberArriveAtLocation: {
    params: appointmentParams,
    detail: barberDetail({
      tag: BARBER_TAGS.appointments,
      summary: 'Tandai Barber Tiba',
      description: 'Menandai barber sudah tiba pada lokasi/cabang. Order harus berstatus confirmed. Backend menghapus cache ETA dan mengubah status database menjadi in_queue dengan alias response arrived.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      successMessage: 'Barber tiba di lokasi',
      successData: {
        ...appointmentRecordExample,
        status: 'arrived',
        raw_status: 'in_queue'
      },
      errors: [
        barberAuthError,
        barberRoleError,
        {
          status: 400,
          description: 'Order tidak berstatus confirmed atau perubahan status gagal.',
          message: 'Barber hanya bisa menandai tiba jika status order adalah confirmed'
        }
      ]
    })
  },

  barberStartService: {
    params: appointmentParams,
    detail: barberDetail({
      tag: BARBER_TAGS.appointments,
      summary: 'Mulai Pelayanan',
      description: 'Mengubah appointment yang ditugaskan kepada barber menjadi in_service, mengisi started_at, memperbarui live status barber menjadi serving di Redis, dan menyiarkan perubahan status.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      successMessage: 'Pelayanan dimulai',
      successData: {
        ...appointmentRecordExample,
        status: 'in_service',
        started_at: '2026-06-25T03:00:00.000Z'
      },
      errors: barberProtectedErrors
    })
  },

  barberCompleteService: {
    params: appointmentParams,
    body: t.Optional(t.Object({
      before_media_url: t.Optional(t.String({
        format: 'uri',
        description: 'URL foto sebelum layanan dari endpoint upload media barber.',
        examples: ['https://api.bombbarbershop.com/public/uploads/reference-before.webp']
      })),
      after_media_url: t.Optional(t.String({
        format: 'uri',
        description: 'URL foto hasil akhir layanan dari endpoint upload media barber.',
        examples: [BARBER_EXAMPLES.imageUrl]
      }))
    }, {
      examples: [
        {},
        {
          before_media_url: 'https://api.bombbarbershop.com/public/uploads/reference-before.webp',
          after_media_url: BARBER_EXAMPLES.imageUrl
        }
      ]
    })),
    detail: barberDetail({
      tag: BARBER_TAGS.appointments,
      summary: 'Selesaikan Pelayanan',
      description: 'Mengubah appointment menjadi completed, mengisi completed_at, menggabungkan URL dokumentasi sebelum/sesudah dengan media customer, menghapus tracking aktif, mengubah status barber menjadi available, dan menyiarkan perubahan status.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      optional: ['body.before_media_url', 'body.after_media_url', 'seluruh body boleh tidak dikirim'],
      successMessage: 'Pelayanan diselesaikan',
      successData: {
        ...appointmentRecordExample,
        status: 'completed',
        completed_at: '2026-06-25T03:45:00.000Z',
        customer_media_urls: [
          'https://api.bombbarbershop.com/public/uploads/reference-before.webp',
          BARBER_EXAMPLES.imageUrl
        ]
      },
      errors: [
        barberAuthError,
        barberRoleError,
        {
          status: 400,
          description: 'Appointment tidak memiliki layanan atau perubahan status gagal.',
          message: 'Tidak bisa menyelesaikan pesanan tanpa layanan'
        }
      ]
    })
  },

  staffQueueAlias: {
    detail: barberDetail({
      tag: BARBER_TAGS.queue,
      summary: 'Alias Staff: Antrean Barber',
      description: 'Alias kompatibilitas GET /api/v1/staff/queue. Response dan otorisasi identik dengan GET /api/v1/barber/queue dan tetap hanya dapat diakses staff yang memiliki profil barber.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Daftar antrean dan order berjalan barber',
      successData: [queueOrderExample],
      errors: [
        barberAuthError,
        barberRoleError,
        {
          status: 400,
          description: 'Profil barber tidak ditemukan atau query antrean gagal.',
          message: 'Profil barber tidak ditemukan'
        },
        barberServerError
      ]
    })
  }
};
