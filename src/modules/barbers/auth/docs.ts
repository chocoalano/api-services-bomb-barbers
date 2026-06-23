import { t } from 'elysia';
import {
  BARBER_EXAMPLES,
  BARBER_TAGS,
  barberAuthError,
  barberDetail,
  barberServerError,
  barberValidationError
} from '../swagger';

const tokenExample = {
  accessToken: BARBER_EXAMPLES.accessToken,
  refreshToken: BARBER_EXAMPLES.refreshToken
};

export const barberAuthDocs = {
  login: {
    body: t.Object({
      email: t.String({
        format: 'email',
        description: 'Alamat email akun staff yang terhubung dengan profil barber.',
        examples: ['andi.barber@bombbarbershop.com']
      }),
      password: t.String({
        minLength: 1,
        description: 'Kata sandi akun staff.',
        examples: ['BombBarber#2026']
      })
    }, {
      examples: [
        {
          email: 'andi.barber@bombbarbershop.com',
          password: 'BombBarber#2026'
        }
      ]
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.auth,
      summary: 'Login Barber',
      description: 'Mengautentikasi barber menggunakan akun staff. JWT yang diterbitkan memiliki role staff; endpoint operasional barber kemudian memverifikasi bahwa staff tersebut benar-benar memiliki profil barber.',
      required: ['body.email', 'body.password'],
      successMessage: 'Login berhasil',
      successData: tokenExample,
      security: false,
      errors: [
        barberValidationError,
        {
          status: 401,
          description: 'Email atau password tidak sesuai.',
          message: 'Kredensial tidak valid'
        },
        {
          status: 403,
          description: 'Kredensial benar tetapi akun staff tidak aktif.',
          message: 'Akun staff tidak aktif'
        },
        {
          status: 429,
          description: 'Percobaan login melebihi batas untuk kombinasi akun dan alamat jaringan.',
          message: 'Terlalu banyak percobaan login. Coba kembali setelah beberapa saat.'
        }
      ]
    })
  },

  refresh: {
    body: t.Object({
      refreshToken: t.String({
        minLength: 1,
        description: 'Refresh token staff/barber yang masih valid.',
        examples: [BARBER_EXAMPLES.refreshToken]
      })
    }, {
      examples: [
        {
          refreshToken: BARBER_EXAMPLES.refreshToken
        }
      ]
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.auth,
      summary: 'Perbarui Token Barber',
      description: 'Memverifikasi refresh token dan status akun staff, lalu menerbitkan access token serta refresh token baru. Aplikasi harus mengganti token lama setelah response berhasil.',
      required: ['body.refreshToken'],
      successMessage: 'Token berhasil diperbarui',
      successData: tokenExample,
      security: false,
      errors: [
        barberValidationError,
        {
          status: 401,
          description: 'Refresh token tidak valid, kedaluwarsa, atau akun staff tidak aktif.',
          message: 'Refresh token tidak valid'
        },
        {
          status: 429,
          description: 'Percobaan refresh token dari alamat jaringan yang sama melebihi batas.',
          message: 'Terlalu banyak percobaan refresh token. Coba kembali setelah beberapa saat.'
        }
      ]
    })
  },

  logout: {
    body: t.Object({
      refreshToken: t.String({
        minLength: 1,
        description: 'Refresh token session staff/barber yang akan dicabut.',
        examples: [BARBER_EXAMPLES.refreshToken]
      })
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.auth,
      summary: 'Logout Barber',
      description: 'Mencabut auth session pada server sehingga seluruh token dalam session tersebut tidak dapat digunakan kembali. Aplikasi tetap wajib menghapus token dari secure storage.',
      required: ['body.refreshToken'],
      successMessage: 'Logout berhasil',
      successData: null,
      security: false,
      errors: [
        {
          status: 401,
          description: 'Refresh token tidak valid atau session sudah dicabut.',
          message: 'Refresh token tidak valid'
        }
      ]
    })
  },

  getProfile: {
    detail: barberDetail({
      tag: BARBER_TAGS.profile,
      summary: 'Ambil Profil Barber',
      description: 'Mengambil identitas staff dan profil barber yang terhubung. Response menyediakan field ringkas untuk dashboard seperti name, branch_area, radius_km, rating_avg, rating_count, serta objek barber dan cabang.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Profil staff berhasil diambil',
      successData: {
        id: BARBER_EXAMPLES.staffId,
        full_name: 'Andi Pratama',
        email: 'andi.barber@bombbarbershop.com',
        phone: '081298765432',
        is_active: true,
        created_at: '2026-01-10T03:00:00.000Z',
        name: 'Andi Barber',
        branch_area: 'Bomb Barbershop Senopati',
        radius_km: 5,
        rating_avg: 4.85,
        rating_count: 124,
        barber: {
          id: BARBER_EXAMPLES.barberId,
          display_name: 'Andi Barber',
          rating_avg: 4.85,
          rating_count: 124,
          live_status: 'available',
          branch: {
            id: BARBER_EXAMPLES.branchId,
            name: 'Bomb Barbershop Senopati',
            address: 'Jl. Senopati No. 88, Jakarta Selatan',
            region_name: 'Jakarta Selatan'
          }
        }
      },
      errors: [
        barberAuthError,
        {
          status: 404,
          description: 'Staff pada token tidak ditemukan.',
          message: 'Staff tidak ditemukan'
        },
        barberServerError
      ]
    })
  }
};
