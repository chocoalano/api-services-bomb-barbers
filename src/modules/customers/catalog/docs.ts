import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerDetail,
  customerServerError,
  customerUuidField,
  customerValidationError
} from '../swagger';

const branchExample = {
  id: CUSTOMER_EXAMPLES.branchId,
  region_id: '22222222-2222-4222-8222-222222222222',
  code: 'JKT-SEN-01',
  name: 'Bomb Barbershop Senopati',
  address: 'Jl. Senopati No. 88, Jakarta Selatan',
  phone: '0215550123',
  latitude: -6.2308,
  longitude: 106.8021,
  is_active: true,
  created_at: '2026-01-10T03:00:00.000Z',
  updated_at: '2026-06-20T07:00:00.000Z',
  deleted_at: null
};

const barberExample = {
  id: CUSTOMER_EXAMPLES.barberId,
  branch_id: CUSTOMER_EXAMPLES.branchId,
  display_name: 'Andi Barber',
  bio: 'Spesialis modern fade dan classic cut.',
  rating_avg: 4.85,
  rating_count: 124,
  live_status: 'available',
  created_at: '2026-01-10T03:00:00.000Z',
  deleted_at: null
};

const serviceExample = {
  id: CUSTOMER_EXAMPLES.serviceId,
  name: 'Haircut',
  description: 'Potong rambut, konsultasi gaya, keramas, dan styling.',
  default_duration_min: 45,
  price_amount: 85000,
  image_url: 'https://api.bombbarbershop.com/public/uploads/service/premium-haircut.webp'
};

const priceExample = {
  id: '99999999-9999-4999-8999-999999999999',
  service_id: CUSTOMER_EXAMPLES.serviceId,
  branch_id: CUSTOMER_EXAMPLES.branchId,
  region_id: null,
  price_amount: 85000,
  effective_from: '2026-01-01T00:00:00.000Z',
  effective_to: null
};

export const catalogDocs = {
  getBranches: {
    detail: customerDetail({
      tag: CUSTOMER_TAGS.catalog,
      summary: 'Daftar Cabang untuk Customer',
      description: 'Mengambil seluruh cabang yang belum dihapus secara soft delete. Data berisi identitas, alamat, kontak, dan koordinat yang dapat digunakan pada daftar cabang maupun peta aplikasi customer.',
      successMessage: 'Daftar cabang berhasil diambil',
      successData: [branchExample],
      security: false,
      errors: [customerServerError]
    })
  },

  getBranchDetail: {
    params: t.Object({
      id: customerUuidField('UUID cabang yang akan dibaca.', CUSTOMER_EXAMPLES.branchId)
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.catalog,
      summary: 'Detail Cabang untuk Customer',
      description: 'Mengambil satu cabang berdasarkan UUID. Endpoint ini digunakan untuk halaman detail cabang sebelum customer memilih barber, layanan, dan jadwal.',
      required: ['path.id'],
      successMessage: 'Detail cabang berhasil diambil',
      successData: branchExample,
      security: false,
      errors: [
        customerValidationError,
        {
          status: 404,
          description: 'Cabang tidak ditemukan atau sudah dihapus.',
          message: 'Cabang tidak ditemukan'
        }
      ]
    })
  },

  getBranchBarbers: {
    params: t.Object({
      id: customerUuidField('UUID cabang pemilik daftar barber.', CUSTOMER_EXAMPLES.branchId)
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.catalog,
      summary: 'Daftar Barber pada Cabang',
      description: 'Mengambil barber yang terdaftar pada cabang tertentu. Setiap data diperkaya dengan live_status dari Redis; apabila status realtime belum tersedia, backend menggunakan nilai available.',
      required: ['path.id'],
      successMessage: 'Daftar barber berhasil diambil',
      successData: [barberExample],
      security: false,
      errors: [
        customerValidationError,
        customerServerError
      ]
    })
  },

  getBranchServices: {
    params: t.Object({
      id: customerUuidField('UUID cabang tempat layanan akan dipesan.', CUSTOMER_EXAMPLES.branchId)
    }),
    query: t.Object({
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 100,
        default: 10,
        description: 'Jumlah maksimal layanan per halaman. Default 10, maksimum 100.',
        examples: [10]
      })),
      page: t.Optional(t.Numeric({
        minimum: 1,
        default: 1,
        description: 'Nomor halaman pagination. Default 1.',
        examples: [1]
      })),
      q: t.Optional(t.String({
        description: 'Kata kunci pencarian pada nama atau deskripsi layanan.',
        examples: ['haircut']
      })),
      search: t.Optional(t.String({
        description: 'Alias dari query q. Jika q dan search dikirim bersamaan, q diprioritaskan.',
        examples: ['fade']
      }))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.catalog,
      summary: 'Daftar Layanan dan Harga Cabang',
      description: 'Mengambil layanan aktif beserta harga efektif untuk cabang. Resolusi harga mengikuti prioritas harga cabang, lalu region, lalu harga global. Endpoint mendukung pagination serta pencarian untuk grid layanan aplikasi customer.',
      required: ['path.id'],
      optional: ['query.limit', 'query.page', 'query.q', 'query.search'],
      successMessage: 'Daftar layanan berhasil diambil',
      successData: [serviceExample],
      security: false,
      errors: [
        customerValidationError,
        {
          status: 404,
          description: 'Cabang tidak ditemukan, tidak aktif, atau sudah dihapus.',
          message: 'Cabang tidak ditemukan atau tidak aktif'
        },
        customerServerError
      ]
    })
  },

  resolveServicePrice: {
    params: t.Object({
      id: customerUuidField('UUID cabang tempat layanan akan dipesan.', CUSTOMER_EXAMPLES.branchId),
      serviceId: customerUuidField('UUID layanan yang harga efektifnya akan dicari.', CUSTOMER_EXAMPLES.serviceId)
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.catalog,
      summary: 'Resolusi Harga Layanan pada Cabang',
      description: 'Mengambil record harga yang berlaku saat ini untuk kombinasi layanan dan cabang. Harga cabang menjadi prioritas utama, dilanjutkan harga region dan harga default global.',
      required: ['path.id', 'path.serviceId'],
      successMessage: 'Harga layanan berhasil diresolusi',
      successData: priceExample,
      security: false,
      errors: [
        customerValidationError,
        {
          status: 404,
          description: 'Cabang, layanan, atau harga efektif tidak ditemukan.',
          message: 'Harga layanan tidak tersedia'
        }
      ]
    })
  }
};
