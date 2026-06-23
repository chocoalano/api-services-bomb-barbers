import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  requestExamples
} from '../swagger';

const adminProfileExample = {
  id: ADMIN_EXAMPLES.staffId,
  full_name: 'Nadia Admin Cabang',
  email: 'admin.ancol@bombbarbers.com',
  phone: '628110000101',
  is_active: true,
  created_at: '2026-06-01T08:00:00.000Z',
  name: 'Nadia Admin Cabang',
  branch_area: '',
  radius_km: 5,
  rating_avg: 0,
  rating_count: 0,
  barber: null
};

export const adminAuthDocs = {
  login: {
    body: t.Object({
      email: t.String({
        format: 'email',
        description: 'Email akun staff admin yang aktif.',
        examples: ['admin.ancol@bombbarbers.com']
      }),
      password: t.String({
        minLength: 8,
        description: 'Kata sandi akun admin.',
        examples: ['Password123!']
      })
    }, requestExamples(
      {
        email: 'admin.ancol@bombbarbers.com',
        password: 'Password123!'
      },
      {
        email: 'admin.ancol@bombbarbers.com',
        password: 'Password123!'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.auth,
      summary: 'Login Admin',
      description: 'Mengautentikasi staff admin dan menghasilkan access token berumur pendek serta refresh token. Role dan scope cabang divalidasi kembali pada endpoint operasional.',
      required: ['email', 'password'],
      optional: [],
      security: false,
      successMessage: 'Login berhasil',
      successData: {
        accessToken: ADMIN_EXAMPLES.accessToken,
        refreshToken: ADMIN_EXAMPLES.refreshToken
      },
      errors: [
        {
          status: 401,
          description: 'Email atau kata sandi tidak valid.',
          message: 'Kredensial tidak valid'
        },
        {
          status: 403,
          description: 'Akun staff ditemukan tetapi sedang tidak aktif.',
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
        description: 'Refresh token admin yang masih valid.',
        examples: [ADMIN_EXAMPLES.refreshToken]
      })
    }, requestExamples(
      { refreshToken: ADMIN_EXAMPLES.refreshToken },
      { refreshToken: ADMIN_EXAMPLES.refreshToken }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.auth,
      summary: 'Perbarui Token Admin',
      description: 'Menerbitkan pasangan access token dan refresh token baru dari refresh token yang valid.',
      required: ['refreshToken'],
      optional: [],
      security: false,
      successMessage: 'Token berhasil diperbarui',
      successData: {
        accessToken: ADMIN_EXAMPLES.accessToken,
        refreshToken: ADMIN_EXAMPLES.refreshToken
      },
      errors: [
        {
          status: 401,
          description: 'Refresh token tidak valid, kedaluwarsa, atau akun staff sudah tidak aktif.',
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
        description: 'Refresh token session admin yang akan dicabut.',
        examples: [ADMIN_EXAMPLES.refreshToken]
      })
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.auth,
      summary: 'Logout Admin',
      description: 'Mencabut auth session pada server sehingga access token dan refresh token session tersebut tidak dapat digunakan kembali.',
      required: ['refreshToken'],
      optional: [],
      security: false,
      successMessage: 'Logout berhasil',
      successData: null,
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
    detail: adminDetail({
      tag: ADMIN_TAGS.auth,
      summary: 'Ambil Profil Admin',
      description: 'Mengambil profil staff berdasarkan JWT yang sedang aktif. Jika staff juga memiliki profil barber, informasi barber akan disertakan.',
      required: ['Authorization: Bearer <access_token>'],
      optional: [],
      successMessage: 'Profil staff berhasil diambil',
      successData: adminProfileExample,
      errors: [
        ...commonAuthErrors,
        {
          status: 404,
          description: 'Profil staff tidak ditemukan.',
          message: 'Staff tidak ditemukan'
        }
      ]
    })
  }
};
