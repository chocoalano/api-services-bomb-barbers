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
  },

  listCustomers: {
    query: t.Object({
      page: t.Optional(t.Integer({ minimum: 1, default: 1, description: 'Nomor halaman (1-based).' })),
      per_page: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20, description: 'Baris per halaman (maks 100).' })),
      q: t.Optional(t.String({ description: 'Pencarian nama/telepon/email.', examples: ['Budi'] })),
      status: t.Optional(t.String({ description: 'Filter status: active | inactive.', examples: ['active'] })),
      sort: t.Optional(t.String({ description: 'Kolom urut: full_name | created_at | points_balance.', examples: ['full_name'] })),
      order: t.Optional(t.String({ description: 'Arah urut: asc | desc.', examples: ['asc'] }))
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.customers,
      summary: 'Daftar Pelanggan (Server-side, Role-scoped)',
      description: 'Daftar pelanggan dengan pagination server-side dan agregat lintas tabel (jumlah appointment, appointment selesai, kunjungan terakhir, total belanja lunas). Cakupan ditentukan peran: super_admin melihat seluruh pelanggan; branch_admin hanya pelanggan yang pernah punya appointment di cabangnya, dan agregatnya pun dibatasi ke cabang tersebut.',
      required: ['Authorization: Bearer <access_token>', 'permission view_customers'],
      optional: ['page', 'per_page', 'q', 'status', 'sort', 'order'],
      successMessage: 'Daftar pelanggan',
      successData: [
        {
          id: ADMIN_EXAMPLES.customerId,
          full_name: 'Budi Santoso',
          phone: '08123456789',
          email: 'budi@example.com',
          points_balance: 120,
          is_active: true,
          created_at: '2026-01-10T03:00:00.000Z',
          stats: { total_appointments: 8, completed_appointments: 6, last_visit_at: '2026-06-20T11:20:00.000Z', total_spent: 540000 }
        }
      ],
      errors: commonAuthErrors
    })
  },

  customerStats: {
    detail: adminDetail({
      tag: ADMIN_TAGS.customers,
      summary: 'Statistik Pelanggan (Role-scoped)',
      description: 'Ringkasan pelanggan sesuai cakupan peran: total, aktif, non-aktif, dan pelanggan baru 30 hari terakhir.',
      required: ['Authorization: Bearer <access_token>', 'permission view_customers'],
      optional: [],
      successMessage: 'Statistik pelanggan',
      successData: { total: 1280, active: 1190, inactive: 90, new_30d: 64 },
      errors: commonAuthErrors
    })
  }
};
