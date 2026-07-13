import { t } from 'elysia';
import { CUSTOMER_TAGS, customerDetail, customerUuidField, CUSTOMER_EXAMPLES } from '../swagger';

const addressBody = t.Object({
  service_address: t.String({
    minLength: 3,
    description: 'Alamat lengkap tujuan (patokan).',
    examples: ['Jl. Sudirman No. 123, dekat Indomaret']
  }),
  location_notes: t.Optional(t.String({
    description: 'Catatan lokasi opsional.',
    examples: ['Pagar hitam, rumah tingkat dua']
  })),
  latitude: t.Numeric({
    minimum: -90, maximum: 90,
    description: 'Latitude titik tujuan.',
    examples: [-6.2277]
  }),
  longitude: t.Numeric({
    minimum: -180, maximum: 180,
    description: 'Longitude titik tujuan.',
    examples: [106.8099]
  })
});

const idParam = t.Object({
  id: customerUuidField('UUID alamat tersimpan.', CUSTOMER_EXAMPLES.reviewId)
});

export const addressDocs = {
  list: {
    detail: customerDetail({
      tag: CUSTOMER_TAGS.addresses,
      summary: 'Daftar Alamat Tersimpan',
      description: 'Menampilkan alamat tujuan yang disimpan customer (terbaru di depan, maksimal 5).'
    })
  },
  create: {
    body: addressBody,
    detail: customerDetail({
      tag: CUSTOMER_TAGS.addresses,
      summary: 'Simpan Alamat',
      description: 'Menyimpan alamat tujuan baru. Bila alamat identik sudah ada akan diperbarui; bila sudah 5 alamat, yang paling lama otomatis dihapus agar total tetap maksimal 5.',
      required: ['service_address', 'latitude', 'longitude'],
      optional: ['location_notes'],
      successStatus: 201
    })
  },
  update: {
    params: idParam,
    body: addressBody,
    detail: customerDetail({
      tag: CUSTOMER_TAGS.addresses,
      summary: 'Perbarui Alamat',
      description: 'Memperbarui alamat tersimpan milik customer.',
      required: ['service_address', 'latitude', 'longitude'],
      optional: ['location_notes']
    })
  },
  remove: {
    params: idParam,
    detail: customerDetail({
      tag: CUSTOMER_TAGS.addresses,
      summary: 'Hapus Alamat',
      description: 'Menghapus alamat tersimpan milik customer.'
    })
  }
};
