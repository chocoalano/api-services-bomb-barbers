import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerAuthError,
  customerDetail,
  customerServerError,
  customerUuidField,
  customerValidationError
} from '../swagger';

const appointmentParams = t.Object({
  id: customerUuidField(
    'UUID appointment milik customer.',
    CUSTOMER_EXAMPLES.appointmentId
  )
});

const customerLocationBody = t.Object({
  lat: t.Numeric({
    minimum: -90,
    maximum: 90,
    description: 'Latitude posisi customer.',
    examples: [-6.2442]
  }),
  lng: t.Numeric({
    minimum: -180,
    maximum: 180,
    description: 'Longitude posisi customer.',
    examples: [106.8096]
  }),
  accuracy_m: t.Optional(t.Numeric({
    minimum: 0,
    maximum: 1000,
    description: 'Akurasi GPS dalam meter.',
    examples: [12]
  })),
  heading: t.Optional(t.Numeric({
    minimum: 0,
    maximum: 359.999,
    description: 'Arah pergerakan dalam derajat.',
    examples: [180]
  })),
  speed_mps: t.Optional(t.Numeric({
    minimum: 0,
    maximum: 100,
    description: 'Kecepatan customer dalam meter per detik.',
    examples: [1.2]
  })),
  captured_at: t.Optional(t.String({
    format: 'date-time',
    description: 'Waktu koordinat diperoleh dari GPS. Maksimal dua menit sebelum request.',
    examples: ['2026-06-25T02:30:00.000Z']
  })),
  eta_minutes: t.Optional(t.Numeric({
    minimum: 0,
    description: 'Field legacy yang diabaikan. ETA barber dihitung oleh server dari lokasi barber dan customer.',
    examples: [18]
  }))
}, {
  examples: [
    {
      lat: -6.2442,
      lng: 106.8096
    },
    {
      lat: -6.2442,
      lng: 106.8096,
      accuracy_m: 12,
      heading: 180,
      speed_mps: 1.2,
      captured_at: '2026-06-25T02:30:00.000Z'
    }
  ]
});

export const trackingDocs = {
  startTracking: {
    params: appointmentParams,
    body: t.Object({
      consent: t.Boolean({
        description: 'Persetujuan eksplisit customer untuk memulai sesi tracking. Harus true.',
        examples: [true]
      })
    }, {
      examples: [
        {
          consent: true
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.tracking,
      summary: 'Mulai Sesi Tracking Customer',
      description: 'Membuat sesi tracking aktif berdurasi maksimal empat jam setelah customer memberikan consent. Jika sesi aktif yang belum kedaluwarsa sudah tersedia, backend mengembalikan sesi tersebut agar request tetap idempoten. Data ETA frekuensi tinggi disimpan di Redis.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id', 'body.consent=true'],
      successStatus: 201,
      successDescription: 'Sesi tracking baru dibuat atau sesi aktif dikembalikan.',
      successMessage: 'Tracking session dimulai',
      successData: {
        id: CUSTOMER_EXAMPLES.trackingSessionId,
        appointment_id: CUSTOMER_EXAMPLES.appointmentId,
        status: 'active',
        consent_given_at: '2026-06-20T08:00:00.000Z',
        expires_at: '2026-06-20T12:00:00.000Z',
        created_at: '2026-06-20T08:00:00.000Z'
      },
      errors: [
        customerAuthError,
        {
          status: 400,
          description: 'Consent tidak diberikan, appointment tidak ditemukan/bukan milik customer, atau appointment sudah selesai.',
          message: 'Tracking membutuhkan consent dari customer.'
        },
        customerServerError
      ]
    })
  },

  getETA: {
    params: appointmentParams,
    detail: customerDetail({
      tag: CUSTOMER_TAGS.tracking,
      summary: 'Ambil ETA dan Lokasi Tracking',
      description: 'Mengambil status appointment, status sesi tracking, ETA, dan lokasi barber. Lokasi live dibaca dari Redis. Jika data live belum tersedia, koordinat cabang digunakan sebagai fallback agar peta customer tetap memiliki titik awal.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id'],
      successMessage: 'ETA tracking berhasil diambil',
      successData: {
        appointment_id: CUSTOMER_EXAMPLES.appointmentId,
        appointment_status: 'confirmed',
        tracking_status: 'active',
        session: {
          id: CUSTOMER_EXAMPLES.trackingSessionId,
          status: 'active',
          consent_given_at: '2026-06-20T08:00:00.000Z',
          expires_at: '2026-06-20T12:00:00.000Z',
          created_at: '2026-06-20T08:00:00.000Z'
        },
        eta_minutes: 18,
        distance_km: 2.4,
        route_source: 'routing_provider',
        updated_at: '2026-06-20T08:15:00.000Z',
        is_live: true,
        source: 'redis',
        lat: -6.2297,
        lng: 106.7998,
        latitude: -6.2297,
        longitude: 106.7998,
        location: {
          lat: -6.2297,
          lng: 106.7998
        },
        barber_location: {
          appointment_id: CUSTOMER_EXAMPLES.appointmentId,
          actor_type: 'barber',
          lat: -6.2297,
          lng: 106.7998,
          sequence: 21
        },
        customer_location: {
          appointment_id: CUSTOMER_EXAMPLES.appointmentId,
          actor_type: 'customer',
          lat: -6.2442,
          lng: 106.8096,
          sequence: 14
        },
        route: {
          source: 'routing_provider',
          distance_km: 2.4,
          eta_minutes: 18,
          calculated_at: '2026-06-20T08:15:00.000Z',
          barber_sequence: 21,
          customer_sequence: 14
        },
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
          latitude: -6.2297,
          longitude: 106.7998,
          location: {
            lat: -6.2297,
            lng: 106.7998
          }
        }
      },
      errors: [
        customerAuthError,
        {
          status: 404,
          description: 'Appointment tidak ditemukan atau bukan milik customer.',
          message: 'Not Found',
          errors: 'Appointment tidak ditemukan.'
        },
        customerServerError
      ]
    })
  },

  updateETA: {
    params: appointmentParams,
    body: customerLocationBody,
    detail: customerDetail({
      tag: CUSTOMER_TAGS.tracking,
      summary: 'Legacy: Perbarui Lokasi Customer',
      description: 'Alias kompatibilitas lama untuk PATCH /tracking/location. Endpoint ini hanya memperbarui lokasi customer. Field eta_minutes diabaikan karena ETA barber dihitung oleh server.',
      required: [
        'Authorization: Bearer <customer_access_token>',
        'path.id',
        'body.lat',
        'body.lng'
      ],
      optional: ['body.accuracy_m', 'body.heading', 'body.speed_mps', 'body.captured_at', 'body.eta_minutes (legacy/diabaikan)'],
      successMessage: 'Lokasi customer berhasil diperbarui',
      successData: {
        customer_location: {
          appointment_id: CUSTOMER_EXAMPLES.appointmentId,
          actor_type: 'customer',
          lat: -6.2442,
          lng: 106.8096,
          accuracy_m: 12,
          captured_at: '2026-06-25T02:30:00.000Z',
          received_at: '2026-06-25T02:30:01.000Z',
          sequence: 14
        },
        route: null
      },
      errors: [
        customerAuthError,
        customerValidationError,
        {
          status: 400,
          description: 'Appointment bukan milik customer, sesi tracking tidak aktif, atau sesi sudah kedaluwarsa.',
          message: 'Bad Request',
          errors: 'Sesi tracking tidak aktif.'
        },
        customerServerError
      ]
    })
  },

  updateLocation: {
    params: appointmentParams,
    body: customerLocationBody,
    detail: customerDetail({
      tag: CUSTOMER_TAGS.tracking,
      summary: 'Perbarui Lokasi Live Customer',
      description: 'Menyimpan lokasi customer pada key Redis terpisah dengan TTL pendek. Endpoint memvalidasi kepemilikan appointment, consent, sesi aktif, status order, freshness timestamp, batas koordinat, dan rate limit.',
      required: [
        'Authorization: Bearer <customer_access_token>',
        'path.id',
        'body.lat',
        'body.lng'
      ],
      optional: ['body.accuracy_m', 'body.heading', 'body.speed_mps', 'body.captured_at'],
      successMessage: 'Lokasi customer berhasil diperbarui',
      successData: {
        customer_location: {
          appointment_id: CUSTOMER_EXAMPLES.appointmentId,
          actor_type: 'customer',
          lat: -6.2442,
          lng: 106.8096,
          accuracy_m: 12,
          captured_at: '2026-06-25T02:30:00.000Z',
          received_at: '2026-06-25T02:30:01.000Z',
          sequence: 14
        },
        route: null
      },
      errors: [
        customerAuthError,
        customerValidationError,
        {
          status: 400,
          description: 'Appointment bukan milik customer, sesi tidak aktif, status belum dapat dilacak, lokasi stale, atau rate limit terlampaui.',
          message: 'Sesi tracking tidak aktif'
        },
        customerServerError
      ]
    })
  },

  checkIn: {
    params: appointmentParams,
    body: t.Object({
      method: t.String({
        minLength: 1,
        description: 'Metode check-in, misalnya gps, qr_code, atau manual.',
        examples: ['gps']
      }),
      lat: t.Optional(t.Numeric({
        minimum: -90,
        maximum: 90,
        description: 'Latitude posisi customer saat check-in.',
        examples: [-6.2308]
      })),
      lng: t.Optional(t.Numeric({
        minimum: -180,
        maximum: 180,
        description: 'Longitude posisi customer saat check-in.',
        examples: [106.8021]
      }))
    }, {
      examples: [
        {
          method: 'manual'
        },
        {
          method: 'gps',
          lat: -6.2308,
          lng: 106.8021
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.tracking,
      summary: 'Check-in Kedatangan Customer',
      description: 'Mencatat kedatangan customer pada appointment. Setelah check-in berhasil, sesi tracking aktif ditandai completed dan cache ETA di Redis dihapus.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id', 'body.method'],
      optional: ['body.lat', 'body.lng'],
      successStatus: 201,
      successMessage: 'Check-in berhasil',
      successData: {
        id: 'abababab-abab-4bab-8bab-abababababab',
        appointment_id: CUSTOMER_EXAMPLES.appointmentId,
        method: 'gps',
        location_lat: -6.2308,
        location_lng: 106.8021,
        checked_in_at: '2026-06-25T02:55:00.000Z',
        created_at: '2026-06-25T02:55:00.000Z'
      },
      errors: [
        customerAuthError,
        customerValidationError,
        customerServerError
      ]
    })
  }
};
