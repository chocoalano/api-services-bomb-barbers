import { t } from 'elysia';
import {
  ADMIN_TAGS,
  ADMIN_EXAMPLES,
  adminDetail,
  commonAuthErrors
} from '../swagger';

const customerSearchExample = [
  {
    id: ADMIN_EXAMPLES.customerId,
    full_name: 'Budi Santoso',
    phone: '08123456789',
    email: 'budi@example.com'
  },
  {
    id: 'a9b8c7d6-e5f4-4a3b-8c2d-1e0f9a8b7c6d',
    full_name: 'Budi Pratama',
    phone: '08198765432',
    email: null
  }
];

export const customerSearchDocs = {
  searchCustomers: {
    query: t.Object({
      q: t.String({
        minLength: 1,
        description: 'Kata kunci pencarian pelanggan. Bisa berupa nama lengkap atau nomor telepon. Pencarian bersifat case-insensitive dan mendukung partial match (tidak perlu mengetik lengkap). Minimal 1 karakter.',
        examples: ['Budi']
      }),
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 50,
        default: 10,
        description: 'Jumlah hasil pencarian maksimal yang dikembalikan. Nilai default adalah 10, dan maksimum 50. Berguna untuk mengontrol jumlah data yang ditampilkan pada komponen autocomplete di frontend.',
        examples: [10]
      }))
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.customers,
      summary: 'Cari Pelanggan',
      description: 'Endpoint pencarian pelanggan untuk digunakan pada form Walk-In dan komponen autocomplete di Admin Panel. Admin dapat mencari berdasarkan nama lengkap atau nomor telepon. Pencarian bersifat case-insensitive dan mendukung partial match menggunakan ILIKE. Hasil diurutkan berdasarkan nama lengkap secara ascending. Semua admin (baik global maupun cabang) dapat mengakses seluruh data pelanggan, karena pelanggan bisa berkunjung ke cabang manapun.',
      required: ['q'],
      optional: ['limit'],
      successMessage: 'Daftar pelanggan',
      successData: customerSearchExample,
      errors: [
        {
          status: 400,
          description: 'Parameter pencarian `q` tidak disertakan atau bernilai kosong.',
          message: 'Parameter q wajib'
        },
        ...commonAuthErrors
      ]
    })
  }
};
