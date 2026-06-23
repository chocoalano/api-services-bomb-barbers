import { t } from 'elysia';
import {
  BARBER_EXAMPLES,
  BARBER_TAGS,
  barberAuthError,
  barberDetail,
  barberServerError,
  barberUuidField,
  barberValidationError
} from '../swagger';

const portfolioExample = {
  id: BARBER_EXAMPLES.portfolioId,
  barber_id: BARBER_EXAMPLES.barberId,
  image_url: BARBER_EXAMPLES.imageUrl,
  caption: 'Modern low fade dengan textured top',
  created_at: '2026-06-20T08:00:00.000Z'
};

export const portfolioDocs = {
  upload: {
    type: 'multipart/form-data',
    body: t.Object({
      file: t.File({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: '5m',
        description: 'Foto hasil kerja barber. Format JPG, PNG, atau WEBP, maksimum 5 MB.'
      }),
      caption: t.Optional(t.String({
        maxLength: 300,
        description: 'Keterangan singkat portfolio, maksimum 300 karakter.',
        examples: ['Modern low fade dengan textured top']
      }))
    }, {
      examples: [
        {
          file: '(binary image file)'
        },
        {
          file: '(binary image file)',
          caption: 'Modern low fade dengan textured top'
        }
      ]
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.portfolio,
      summary: 'Upload Portfolio Barber',
      description: 'Mengoptimasi gambar menjadi WebP, menyimpannya di kategori portfolio, lalu membuat record barber_portfolios milik barber pada token. Portfolio ini dapat ditampilkan pada galeri customer.',
      required: ['Authorization: Bearer <barber_access_token>', 'multipart file'],
      optional: ['multipart caption'],
      successStatus: 201,
      successMessage: 'Portfolio berhasil diupload',
      successData: portfolioExample,
      errors: [
        barberAuthError,
        barberValidationError,
        {
          status: 400,
          description: 'Staff tidak memiliki profil barber atau penyimpanan portfolio gagal.',
          message: 'Profil barber tidak ditemukan'
        },
        barberServerError
      ]
    })
  },

  list: {
    detail: barberDetail({
      tag: BARBER_TAGS.portfolio,
      summary: 'Daftar Portfolio Barber Saya',
      description: 'Mengambil seluruh portfolio milik barber pada token, diurutkan berdasarkan created_at terbaru. Barber tidak dapat membaca portfolio barber lain melalui endpoint ini.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Daftar portfolio barber',
      successData: [portfolioExample],
      errors: [
        barberAuthError,
        {
          status: 400,
          description: 'Profil barber tidak ditemukan atau query portfolio gagal.',
          message: 'Profil barber tidak ditemukan'
        },
        barberServerError
      ]
    })
  },

  remove: {
    params: t.Object({
      id: barberUuidField(
        'UUID portfolio yang akan dihapus. Record harus dimiliki barber pada token.',
        BARBER_EXAMPLES.portfolioId
      )
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.portfolio,
      summary: 'Hapus Portfolio Barber',
      description: 'Menghapus record portfolio berdasarkan UUID dan barber_id pemilik token. Implementasi saat ini menghapus record database; file fisik yang sudah tersimpan tidak ikut dihapus.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      successMessage: 'Portfolio berhasil dihapus',
      successData: null,
      errors: [
        barberAuthError,
        barberValidationError,
        {
          status: 400,
          description: 'Profil barber tidak ditemukan atau operasi delete gagal.',
          message: 'Gagal menghapus portfolio'
        },
        barberServerError
      ]
    })
  }
};
