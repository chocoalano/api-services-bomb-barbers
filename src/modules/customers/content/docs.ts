import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerAuthError,
  customerDateTimeField,
  customerDetail,
  customerServerError,
  customerUuidField,
  customerValidationError
} from '../swagger';

export const contentDocs = {
  getBanners: {
    query: t.Object({
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 30,
        default: 10,
        description: 'Jumlah maksimal banner aktif. Default 10, maksimum 30.',
        examples: [10]
      }))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.content,
      summary: 'Daftar Banner Aktif',
      description: 'Mengambil banner promosi yang aktif, belum dihapus, memiliki gambar, dan masih berada dalam periode tayang. Urutan mengikuti sort_order lalu waktu pembuatan terbaru.',
      optional: ['query.limit'],
      successMessage: 'Daftar banner berhasil diambil',
      successData: [
        {
          id: '13131313-1313-4313-8313-131313131313',
          title: 'Promo Grooming Weekend',
          subtitle: 'Diskon 20% untuk Premium Haircut',
          image_url: 'https://api.bombbarbershop.com/public/uploads/promotion/weekend.webp',
          target_url: 'bombbarbershop://services/88888888-8888-4888-8888-888888888888',
          starts_at: '2026-06-20T00:00:00.000Z',
          ends_at: '2026-06-30T23:59:59.000Z',
          sort_order: 1,
          created_at: '2026-06-15T03:00:00.000Z'
        }
      ],
      security: false,
      errors: [
        customerValidationError,
        customerServerError
      ]
    })
  },

  getGallery: {
    query: t.Object({
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 100,
        default: 30,
        description: 'Jumlah maksimal portfolio yang dikembalikan. Default 30, maksimum 100.',
        examples: [12]
      })),
      barber_id: t.Optional(customerUuidField(
        'Filter portfolio berdasarkan UUID barber.',
        CUSTOMER_EXAMPLES.barberId
      )),
      branch_id: t.Optional(customerUuidField(
        'Filter portfolio berdasarkan UUID cabang barber.',
        CUSTOMER_EXAMPLES.branchId
      ))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.content,
      summary: 'Galeri Hasil Layanan',
      description: 'Mengambil portfolio hasil akhir barber yang belum dihapus. Filter barber_id dan branch_id dapat digunakan sendiri atau bersamaan untuk halaman inspirasi gaya maupun profil barber.',
      optional: ['query.limit', 'query.barber_id', 'query.branch_id'],
      successMessage: 'Gallery layanan berhasil diambil',
      successData: [
        {
          id: '14141414-1414-4414-8414-141414141414',
          barber_id: CUSTOMER_EXAMPLES.barberId,
          image_url: 'https://api.bombbarbershop.com/public/uploads/portfolio/modern-fade.webp',
          caption: 'Modern low fade dengan textured top',
          created_at: '2026-06-18T05:00:00.000Z',
          barber: {
            id: CUSTOMER_EXAMPLES.barberId,
            branch_id: CUSTOMER_EXAMPLES.branchId,
            display_name: 'Andi Barber',
            deleted_at: null
          }
        }
      ],
      security: false,
      errors: [
        customerValidationError,
        customerServerError
      ]
    })
  },

  getCustomerNotifications: {
    query: t.Object({
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 50,
        default: 20,
        description: 'Jumlah maksimal notifikasi. Default 20, maksimum 50.',
        examples: [20]
      })),
      unread_only: t.Optional(t.BooleanString({
        description: 'Jika true, hanya notifikasi yang read_at-nya null yang dikembalikan.',
        examples: ['true']
      })),
      before: t.Optional(customerDateTimeField(
        'Cursor created_at untuk mengambil notifikasi yang lebih lama.',
        '2026-06-20T08:00:00.000Z'
      ))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.content,
      summary: 'Daftar Notifikasi Customer',
      description: 'Mengambil notification center customer berdasarkan identitas JWT. Response berisi items dan unread_count sehingga frontend dapat menampilkan daftar sekaligus badge notifikasi belum dibaca.',
      required: ['Authorization: Bearer <customer_access_token>'],
      optional: ['query.limit', 'query.unread_only', 'query.before'],
      successMessage: 'Daftar notifikasi berhasil diambil',
      successData: {
        items: [
          {
            id: CUSTOMER_EXAMPLES.notificationId,
            title: 'Booking dikonfirmasi',
            body: 'Appointment Anda pada 25 Juni 2026 pukul 10.00 telah dikonfirmasi.',
            type: 'appointment_confirmed',
            sent_at: '2026-06-20T08:10:00.000Z',
            read_at: null,
            created_at: '2026-06-20T08:10:00.000Z',
            is_read: false
          }
        ],
        unread_count: 3
      },
      errors: [
        customerAuthError,
        customerValidationError,
        customerServerError
      ]
    })
  }
};
