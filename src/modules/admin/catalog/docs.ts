import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonMutationErrors,
  isoDateTimeField,
  requestExamples,
  uuidField
} from '../swagger';

const branchExample = {
  id: ADMIN_EXAMPLES.branchId,
  region_id: ADMIN_EXAMPLES.regionId,
  name: 'Bomb Barbershop Jakarta Ancol',
  address: 'Jl. Lodan Raya No. 1, Jakarta Utara',
  phone: '021-22770012',
  latitude: -6.175662,
  longitude: 106.599256,
  is_active: true,
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:00:00.000Z',
  deleted_at: null
};

const barberExample = {
  id: ADMIN_EXAMPLES.barberId,
  staff_user_id: ADMIN_EXAMPLES.staffId,
  branch_id: ADMIN_EXAMPLES.branchId,
  display_name: 'Budi Santoso',
  bio: 'Spesialis fade dan classic cut.',
  rating_avg: 4.85,
  rating_count: 120,
  live_status: 'available',
  service_radius_km: 5,
  default_commission_rule_id: null,
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:00:00.000Z',
  deleted_at: null
};

const serviceExample = {
  id: ADMIN_EXAMPLES.serviceId,
  name: 'Premium Haircut',
  description: 'Potong rambut premium termasuk konsultasi dan styling.',
  image_url: 'https://api.bombbarbershop.com/public/uploads/service/premium-haircut.webp',
  default_duration_min: 45,
  is_active: true,
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:00:00.000Z',
  deleted_at: null
};

const priceExample = {
  id: ADMIN_EXAMPLES.servicePriceId,
  service_id: ADMIN_EXAMPLES.serviceId,
  branch_id: ADMIN_EXAMPLES.branchId,
  region_id: null,
  price_amount: 85000,
  effective_from: '2026-06-20T00:00:00.000Z',
  effective_to: null,
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:00:00.000Z'
};

const idParams = (description: string, example: string) =>
  t.Object({ id: uuidField(description, example) });

export const adminCatalogDocs = {
  listBranches: {
    detail: adminDetail({
      tag: ADMIN_TAGS.branches,
      summary: 'Daftar Cabang',
      description: 'Mengembalikan semua cabang yang dapat diakses staff. super_admin mendapat semua cabang aktif; branch_admin hanya mendapat cabang dalam scope mereka.',
      required: ['Authorization: Bearer <access_token>'],
      optional: [],
      successMessage: 'Daftar cabang',
      successData: [branchExample],
      errors: commonMutationErrors
    })
  },
  listHqBranches: {
    detail: adminDetail({
      tag: ADMIN_TAGS.branches,
      summary: 'Daftar Semua Cabang (HQ)',
      description: 'Mengembalikan seluruh cabang aktif. Khusus super_admin.',
      required: ['Authorization: Bearer <access_token>', "role 'super_admin'"],
      optional: [],
      successMessage: 'Daftar cabang',
      successData: [branchExample],
      errors: commonMutationErrors
    })
  },
  listBarbers: {
    detail: adminDetail({
      tag: ADMIN_TAGS.barbers,
      summary: 'Daftar Semua Barber (HQ)',
      description: 'Mengambil seluruh barber aktif lintas cabang beserta informasi cabang dan staff terkait.',
      required: ['Authorization: Bearer <access_token>', "permission 'manage_barber'"],
      optional: [],
      successMessage: 'Daftar barber',
      successData: [barberExample],
      errors: commonMutationErrors
    })
  },
  listServices: {
    detail: adminDetail({
      tag: ADMIN_TAGS.services,
      summary: 'Daftar Layanan',
      description: 'Mengambil seluruh layanan aktif yang tersedia.',
      required: ['Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: [],
      successMessage: 'Daftar layanan',
      successData: [serviceExample],
      errors: commonMutationErrors
    })
  },
  listServicePrices: {
    detail: adminDetail({
      tag: ADMIN_TAGS.services,
      summary: 'Daftar Harga Layanan',
      description: 'Mengambil seluruh entri harga layanan beserta nama layanan dan cabang terkait.',
      required: ['Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: [],
      successMessage: 'Daftar harga layanan',
      successData: [priceExample],
      errors: commonMutationErrors
    })
  },
  createBranch: {
    body: t.Object({
      name: t.String({
        minLength: 2,
        maxLength: 255,
        description: 'Nama resmi cabang.',
        examples: ['Bomb Barbershop Jakarta Ancol']
      }),
      region_id: uuidField('UUID region tempat cabang berada.', ADMIN_EXAMPLES.regionId),
      address: t.Optional(t.String({
        description: 'Alamat lengkap cabang.',
        examples: ['Jl. Lodan Raya No. 1, Jakarta Utara']
      })),
      phone: t.Optional(t.String({
        description: 'Nomor telepon cabang.',
        examples: ['021-22770012']
      })),
      latitude: t.Optional(t.Numeric({
        minimum: -90,
        maximum: 90,
        description: 'Latitude lokasi cabang.',
        examples: [-6.175662]
      })),
      longitude: t.Optional(t.Numeric({
        minimum: -180,
        maximum: 180,
        description: 'Longitude lokasi cabang.',
        examples: [106.599256]
      })),
      is_active: t.Optional(t.Boolean({
        description: 'Status operasional cabang. Default database adalah true.',
        examples: [true]
      }))
    }, requestExamples(
      {
        name: 'Bomb Barbershop Jakarta Ancol',
        region_id: ADMIN_EXAMPLES.regionId
      },
      {
        name: 'Bomb Barbershop Jakarta Ancol',
        region_id: ADMIN_EXAMPLES.regionId,
        address: 'Jl. Lodan Raya No. 1, Jakarta Utara',
        phone: '021-22770012',
        latitude: -6.175662,
        longitude: 106.599256,
        is_active: true
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.branches,
      summary: 'Buat Cabang',
      description: 'Mendaftarkan cabang baru ke master data HQ.',
      required: ['name', 'region_id', 'Authorization: Bearer <access_token>', "permission 'manage_branch'"],
      optional: ['address', 'phone', 'latitude', 'longitude', 'is_active'],
      successStatus: 201,
      successMessage: 'Branch dibuat',
      successData: branchExample,
      errors: commonMutationErrors
    })
  },
  updateBranch: {
    params: idParams('UUID cabang yang akan diperbarui.', ADMIN_EXAMPLES.branchId),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 2, examples: ['Bomb Barbershop Ancol Utama'] })),
      region_id: t.Optional(uuidField('UUID region baru.', ADMIN_EXAMPLES.regionId)),
      address: t.Optional(t.String({ examples: ['Jl. Lodan Raya No. 2, Jakarta Utara'] })),
      phone: t.Optional(t.String({ examples: ['021-22770099'] })),
      latitude: t.Optional(t.Numeric({ minimum: -90, maximum: 90, examples: [-6.1757] })),
      longitude: t.Optional(t.Numeric({ minimum: -180, maximum: 180, examples: [106.5993] })),
      is_active: t.Optional(t.Boolean({ examples: [true] }))
    }, requestExamples(
      { name: 'Bomb Barbershop Ancol Utama' },
      {
        name: 'Bomb Barbershop Ancol Utama',
        region_id: ADMIN_EXAMPLES.regionId,
        address: 'Jl. Lodan Raya No. 2, Jakarta Utara',
        phone: '021-22770099',
        latitude: -6.1757,
        longitude: 106.5993,
        is_active: true
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.branches,
      summary: 'Perbarui Cabang',
      description: 'Memperbarui satu atau beberapa atribut cabang. Kirim hanya field yang ingin diubah.',
      required: ['path id', 'minimal satu field body', 'Authorization: Bearer <access_token>', "permission 'manage_branch'"],
      optional: ['name', 'region_id', 'address', 'phone', 'latitude', 'longitude', 'is_active'],
      successMessage: 'Branch diupdate',
      successData: { ...branchExample, name: 'Bomb Barbershop Ancol Utama' },
      errors: commonMutationErrors
    })
  },
  deleteBranch: {
    params: idParams('UUID cabang yang akan dihapus secara soft delete.', ADMIN_EXAMPLES.branchId),
    detail: adminDetail({
      tag: ADMIN_TAGS.branches,
      summary: 'Hapus Cabang',
      description: 'Melakukan soft delete dengan mengisi deleted_at sehingga data historis cabang tetap tersedia.',
      required: ['path id', 'Authorization: Bearer <access_token>', "permission 'manage_branch'"],
      optional: [],
      successMessage: 'Branch dihapus',
      successData: null,
      errors: commonMutationErrors
    })
  },

  createBarber: {
    body: t.Object({
      staff_user_id: uuidField('UUID staff user yang menjadi akun login barber.', ADMIN_EXAMPLES.staffId),
      branch_id: uuidField('UUID cabang penempatan barber.', ADMIN_EXAMPLES.branchId),
      display_name: t.String({
        minLength: 2,
        maxLength: 255,
        description: 'Nama barber yang tampil di aplikasi.',
        examples: ['Budi Santoso']
      }),
      bio: t.Optional(t.String({
        maxLength: 1000,
        description: 'Biografi atau spesialisasi barber.',
        examples: ['Spesialis fade dan classic cut.']
      })),
      service_radius_km: t.Optional(t.Numeric({
        minimum: 0,
        description: 'Radius layanan home service dalam kilometer.',
        examples: [5]
      })),
      default_commission_rule_id: t.Optional(uuidField(
        'UUID aturan komisi default barber.',
        '67676767-6767-4676-8676-676767676767'
      ))
    }, requestExamples(
      {
        staff_user_id: ADMIN_EXAMPLES.staffId,
        branch_id: ADMIN_EXAMPLES.branchId,
        display_name: 'Budi Santoso'
      },
      {
        staff_user_id: ADMIN_EXAMPLES.staffId,
        branch_id: ADMIN_EXAMPLES.branchId,
        display_name: 'Budi Santoso',
        bio: 'Spesialis fade dan classic cut.',
        service_radius_km: 5,
        default_commission_rule_id: '67676767-6767-4676-8676-676767676767'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.barbers,
      summary: 'Buat Profil Barber',
      description: 'Menghubungkan akun staff dengan profil barber dan menempatkannya pada cabang tertentu.',
      required: ['staff_user_id', 'branch_id', 'display_name', 'Authorization: Bearer <access_token>', "permission 'manage_barber'"],
      optional: ['bio', 'service_radius_km', 'default_commission_rule_id'],
      successStatus: 201,
      successMessage: 'Barber dibuat',
      successData: barberExample,
      errors: commonMutationErrors
    })
  },
  updateBarber: {
    params: idParams('UUID profil barber.', ADMIN_EXAMPLES.barberId),
    body: t.Object({
      staff_user_id: t.Optional(uuidField('UUID staff user pengganti.', ADMIN_EXAMPLES.staffId)),
      branch_id: t.Optional(uuidField('UUID cabang penempatan baru.', ADMIN_EXAMPLES.branchId)),
      display_name: t.Optional(t.String({ minLength: 2, examples: ['Budi The Barber'] })),
      bio: t.Optional(t.String({ maxLength: 1000, examples: ['Spesialis modern fade.'] })),
      service_radius_km: t.Optional(t.Numeric({ minimum: 0, examples: [8] })),
      live_status: t.Optional(t.UnionEnum(['offline', 'available', 'serving'], {
        description: 'Status barber tersimpan. Status realtime utama tetap berasal dari Redis.',
        examples: ['available']
      })),
      default_commission_rule_id: t.Optional(uuidField(
        'UUID aturan komisi default.',
        '67676767-6767-4676-8676-676767676767'
      ))
    }, requestExamples(
      { display_name: 'Budi The Barber' },
      {
        staff_user_id: ADMIN_EXAMPLES.staffId,
        branch_id: ADMIN_EXAMPLES.branchId,
        display_name: 'Budi The Barber',
        bio: 'Spesialis modern fade.',
        service_radius_km: 8,
        live_status: 'available',
        default_commission_rule_id: '67676767-6767-4676-8676-676767676767'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.barbers,
      summary: 'Perbarui Profil Barber',
      description: 'Memperbarui profil, penempatan cabang, radius layanan, atau aturan komisi barber.',
      required: ['path id', 'minimal satu field body', 'Authorization: Bearer <access_token>', "permission 'manage_barber'"],
      optional: ['staff_user_id', 'branch_id', 'display_name', 'bio', 'service_radius_km', 'live_status', 'default_commission_rule_id'],
      successMessage: 'Barber diupdate',
      successData: { ...barberExample, display_name: 'Budi The Barber', service_radius_km: 8 },
      errors: commonMutationErrors
    })
  },
  deleteBarber: {
    params: idParams('UUID profil barber.', ADMIN_EXAMPLES.barberId),
    detail: adminDetail({
      tag: ADMIN_TAGS.barbers,
      summary: 'Hapus Profil Barber',
      description: 'Menghapus profil barber berdasarkan UUID.',
      required: ['path id', 'Authorization: Bearer <access_token>', "permission 'manage_barber'"],
      optional: [],
      successMessage: 'Barber dihapus',
      successData: null,
      errors: commonMutationErrors
    })
  },

  createService: {
    body: t.Object({
      name: t.String({ minLength: 2, maxLength: 255, examples: ['Premium Haircut'] }),
      default_duration_min: t.Integer({
        minimum: 1,
        description: 'Durasi default layanan dalam menit.',
        examples: [45]
      }),
      description: t.Optional(t.String({
        description: 'Deskripsi layanan untuk aplikasi customer.',
        examples: ['Potong rambut premium termasuk konsultasi dan styling.']
      })),
      image_url: t.Optional(t.String({
        format: 'uri',
        description: 'URL gambar layanan hasil upload media.',
        examples: ['https://api.bombbarbershop.com/public/uploads/service/premium-haircut.webp']
      })),
      is_active: t.Optional(t.Boolean({
        description: 'Menentukan apakah layanan bisa dipesan.',
        examples: [true]
      }))
    }, requestExamples(
      { name: 'Premium Haircut', default_duration_min: 45 },
      {
        name: 'Premium Haircut',
        default_duration_min: 45,
        description: 'Potong rambut premium termasuk konsultasi dan styling.',
        image_url: 'https://api.bombbarbershop.com/public/uploads/service/premium-haircut.webp',
        is_active: true
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.services,
      summary: 'Buat Layanan',
      description: 'Mendaftarkan layanan baru yang dapat diberi harga global, region, atau cabang.',
      required: ['name', 'default_duration_min', 'Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: ['description', 'image_url', 'is_active'],
      successStatus: 201,
      successMessage: 'Service dibuat',
      successData: serviceExample,
      errors: commonMutationErrors
    })
  },
  updateService: {
    params: idParams('UUID layanan.', ADMIN_EXAMPLES.serviceId),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 2, examples: ['Premium Haircut Plus'] })),
      default_duration_min: t.Optional(t.Integer({ minimum: 1, examples: [60] })),
      description: t.Optional(t.String({ examples: ['Termasuk haircut, wash, dan styling.'] })),
      image_url: t.Optional(t.String({
        format: 'uri',
        examples: ['https://api.bombbarbershop.com/public/uploads/service/premium-haircut-plus.webp']
      })),
      is_active: t.Optional(t.Boolean({ examples: [true] }))
    }, requestExamples(
      { name: 'Premium Haircut Plus' },
      {
        name: 'Premium Haircut Plus',
        default_duration_min: 60,
        description: 'Termasuk haircut, wash, dan styling.',
        image_url: 'https://api.bombbarbershop.com/public/uploads/service/premium-haircut-plus.webp',
        is_active: true
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.services,
      summary: 'Perbarui Layanan',
      description: 'Memperbarui informasi layanan. Kirim hanya atribut yang berubah.',
      required: ['path id', 'minimal satu field body', 'Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: ['name', 'default_duration_min', 'description', 'image_url', 'is_active'],
      successMessage: 'Service diupdate',
      successData: { ...serviceExample, name: 'Premium Haircut Plus', default_duration_min: 60 },
      errors: commonMutationErrors
    })
  },
  deleteService: {
    params: idParams('UUID layanan yang akan dihapus secara soft delete.', ADMIN_EXAMPLES.serviceId),
    detail: adminDetail({
      tag: ADMIN_TAGS.services,
      summary: 'Hapus Layanan',
      description: 'Melakukan soft delete layanan agar layanan tidak tampil pada katalog customer.',
      required: ['path id', 'Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: [],
      successMessage: 'Service dihapus',
      successData: null,
      errors: commonMutationErrors
    })
  },

  createServicePrice: {
    body: t.Object({
      service_id: uuidField('UUID layanan.', ADMIN_EXAMPLES.serviceId),
      price_amount: t.Integer({
        minimum: 0,
        description: 'Harga dalam rupiah penuh tanpa desimal.',
        examples: [85000]
      }),
      effective_from: isoDateTimeField(
        'Waktu mulai berlakunya harga.',
        '2026-06-20T00:00:00.000Z'
      ),
      branch_id: t.Optional(uuidField(
        'UUID cabang untuk harga khusus cabang.',
        ADMIN_EXAMPLES.branchId
      )),
      region_id: t.Optional(uuidField(
        'UUID region untuk harga khusus region.',
        ADMIN_EXAMPLES.regionId
      )),
      effective_to: t.Optional(isoDateTimeField(
        'Waktu akhir berlakunya harga. Hilangkan untuk tanpa batas akhir.',
        '2026-12-31T23:59:59.000Z'
      ))
    }, requestExamples(
      {
        service_id: ADMIN_EXAMPLES.serviceId,
        price_amount: 75000,
        effective_from: '2026-06-20T00:00:00.000Z'
      },
      {
        service_id: ADMIN_EXAMPLES.serviceId,
        price_amount: 85000,
        effective_from: '2026-06-20T00:00:00.000Z',
        branch_id: ADMIN_EXAMPLES.branchId,
        region_id: ADMIN_EXAMPLES.regionId,
        effective_to: '2026-12-31T23:59:59.000Z'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.prices,
      summary: 'Buat Harga Layanan',
      description: 'Membuat harga layanan. Tanpa branch_id dan region_id berarti harga global; branch_id memiliki prioritas tertinggi saat resolusi harga.',
      required: ['service_id', 'price_amount', 'effective_from', 'Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: ['branch_id', 'region_id', 'effective_to'],
      successStatus: 201,
      successMessage: 'Price dibuat',
      successData: priceExample,
      errors: commonMutationErrors
    })
  },
  updateServicePrice: {
    params: idParams('UUID record harga layanan.', ADMIN_EXAMPLES.servicePriceId),
    body: t.Object({
      service_id: t.Optional(uuidField('UUID layanan baru.', ADMIN_EXAMPLES.serviceId)),
      price_amount: t.Optional(t.Integer({ minimum: 0, examples: [90000] })),
      effective_from: t.Optional(isoDateTimeField('Waktu mulai baru.', '2026-07-01T00:00:00.000Z')),
      branch_id: t.Optional(uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId)),
      region_id: t.Optional(uuidField('UUID region.', ADMIN_EXAMPLES.regionId)),
      effective_to: t.Optional(isoDateTimeField('Waktu akhir baru.', '2026-12-31T23:59:59.000Z'))
    }, requestExamples(
      { price_amount: 90000 },
      {
        service_id: ADMIN_EXAMPLES.serviceId,
        price_amount: 90000,
        effective_from: '2026-07-01T00:00:00.000Z',
        branch_id: ADMIN_EXAMPLES.branchId,
        region_id: ADMIN_EXAMPLES.regionId,
        effective_to: '2026-12-31T23:59:59.000Z'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.prices,
      summary: 'Perbarui Harga Layanan',
      description: 'Memperbarui nominal, scope, atau periode efektif harga layanan.',
      required: ['path id', 'minimal satu field body', 'Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: ['service_id', 'price_amount', 'effective_from', 'branch_id', 'region_id', 'effective_to'],
      successMessage: 'Price diupdate',
      successData: { ...priceExample, price_amount: 90000 },
      errors: commonMutationErrors
    })
  },
  deleteServicePrice: {
    params: idParams('UUID record harga layanan.', ADMIN_EXAMPLES.servicePriceId),
    detail: adminDetail({
      tag: ADMIN_TAGS.prices,
      summary: 'Hapus Harga Layanan',
      description: 'Menghapus record harga layanan berdasarkan UUID.',
      required: ['path id', 'Authorization: Bearer <access_token>', "permission 'manage_service'"],
      optional: [],
      successMessage: 'Price dihapus',
      successData: null,
      errors: commonMutationErrors
    })
  }
};
