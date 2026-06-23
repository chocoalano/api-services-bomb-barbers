import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerAuthError,
  customerDetail,
  customerServerError,
  customerValidationError
} from '../swagger';

const customerProfileExample = {
  id: CUSTOMER_EXAMPLES.customerId,
  full_name: 'Budi Santoso',
  email: 'budi.santoso@example.com',
  phone: '081234567890',
  is_active: true,
  created_at: '2026-06-20T08:00:00.000Z',
  updated_at: '2026-06-20T08:00:00.000Z'
};

const tokenExample = {
  accessToken: CUSTOMER_EXAMPLES.accessToken,
  refreshToken: CUSTOMER_EXAMPLES.refreshToken
};

export const customerAuthDocs = {
  register: {
    body: t.Object({
      full_name: t.String({
        minLength: 2,
        description: 'Nama lengkap pelanggan. Minimal 2 karakter.',
        examples: ['Budi Santoso']
      }),
      email: t.Optional(t.String({
        format: 'email',
        description: 'Alamat email unik pelanggan. Field ini opsional, tetapi harus berformat email dan belum digunakan akun lain jika dikirim.',
        examples: ['budi.santoso@example.com']
      })),
      phone: t.String({
        minLength: 8,
        error: 'Nomor telepon wajib berupa teks dan minimal 8 karakter',
        description: 'Nomor telepon aktif dan unik. Minimal 8 karakter.',
        examples: ['081234567890']
      }),
      password: t.String({
        minLength: 8,
        error: 'Kata sandi wajib berupa teks dan minimal 8 karakter',
        description: 'Kata sandi akun pelanggan. Minimal 8 karakter.',
        examples: ['BombBarber#2026']
      })
    }, {
      examples: [
        {
          full_name: 'Budi Santoso',
          phone: '081234567890',
          password: 'BombBarber#2026'
        },
        {
          full_name: 'Budi Santoso',
          email: 'budi.santoso@example.com',
          phone: '081234567890',
          password: 'BombBarber#2026'
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.auth,
      summary: 'Registrasi Customer',
      description: 'Mendaftarkan akun pelanggan baru. Sistem melakukan normalisasi dan validasi data, memastikan nomor telepon serta email belum terdaftar, lalu menyimpan password dalam bentuk hash. Response tidak pernah mengembalikan password atau password hash.',
      required: ['body.full_name', 'body.phone', 'body.password'],
      optional: ['body.email'],
      successStatus: 201,
      successDescription: 'Akun customer berhasil dibuat.',
      successMessage: 'Pelanggan berhasil didaftarkan',
      successData: customerProfileExample,
      security: false,
      errors: [
        customerValidationError,
        {
          status: 409,
          description: 'Nomor telepon atau email sudah digunakan pelanggan lain.',
          message: 'Nomor telepon sudah terdaftar'
        },
        customerServerError
      ]
    })
  },

  login: {
    body: t.Object({
      email: t.Optional(t.Union([
        t.String({ format: 'email' }),
        t.Literal('')
      ], {
        description: 'Email terdaftar. Isi email atau phone, tidak perlu keduanya.',
        examples: ['budi.santoso@example.com']
      })),
      phone: t.Optional(t.Union([
        t.String({ minLength: 8 }),
        t.Literal('')
      ], {
        description: 'Nomor telepon terdaftar. Isi phone atau email, tidak perlu keduanya.',
        examples: ['081234567890']
      })),
      password: t.String({
        minLength: 8,
        error: 'Kata sandi wajib berupa teks dan minimal 8 karakter',
        description: 'Kata sandi akun pelanggan.',
        examples: ['BombBarber#2026']
      })
    }, {
      examples: [
        {
          phone: '081234567890',
          password: 'BombBarber#2026'
        },
        {
          email: 'budi.santoso@example.com',
          phone: '',
          password: 'BombBarber#2026'
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.auth,
      summary: 'Login Customer',
      description: 'Mengautentikasi pelanggan menggunakan nomor telepon atau email. Access token digunakan pada header Authorization untuk endpoint terproteksi, sedangkan refresh token digunakan untuk memperoleh pasangan token baru.',
      required: ['body.password', 'salah satu dari body.phone atau body.email'],
      optional: ['body.email jika login menggunakan phone', 'body.phone jika login menggunakan email'],
      successMessage: 'Login berhasil',
      successData: tokenExample,
      security: false,
      errors: [
        customerValidationError,
        {
          status: 401,
          description: 'Email, nomor telepon, atau password tidak sesuai.',
          message: 'Kredensial tidak valid'
        },
        {
          status: 403,
          description: 'Kredensial benar tetapi akun customer sedang tidak aktif.',
          message: 'Akun pelanggan tidak aktif'
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
        description: 'Refresh token customer yang masih valid.',
        examples: [CUSTOMER_EXAMPLES.refreshToken]
      })
    }, {
      examples: [
        {
          refreshToken: CUSTOMER_EXAMPLES.refreshToken
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.auth,
      summary: 'Perbarui Token Customer',
      description: 'Memverifikasi refresh token dan status akun customer, kemudian menerbitkan access token serta refresh token baru. Token lama sebaiknya segera diganti di aplikasi setelah response berhasil diterima.',
      required: ['body.refreshToken'],
      successMessage: 'Token berhasil diperbarui',
      successData: tokenExample,
      security: false,
      errors: [
        customerValidationError,
        {
          status: 401,
          description: 'Refresh token tidak valid, kedaluwarsa, atau customer sudah tidak aktif.',
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
        description: 'Refresh token session yang akan dicabut.',
        examples: [CUSTOMER_EXAMPLES.refreshToken]
      })
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.auth,
      summary: 'Logout Customer',
      description: 'Mencabut auth session pada server sehingga access token dan refresh token dalam session yang sama tidak dapat digunakan kembali. Aplikasi tetap wajib menghapus kedua token dari secure storage.',
      required: ['body.refreshToken'],
      successMessage: 'Logout berhasil',
      successData: null,
      security: false,
      errors: [
        {
          status: 401,
          description: 'Refresh token tidak valid atau session sudah tidak tersedia.',
          message: 'Refresh token tidak valid'
        }
      ]
    })
  },

  getProfile: {
    detail: customerDetail({
      tag: CUSTOMER_TAGS.profile,
      summary: 'Ambil Profil Customer',
      description: 'Mengambil data profil customer berdasarkan identitas pada JWT access token. Endpoint hanya dapat membaca profil pemilik token dan tidak menerima customer ID dari client.',
      required: ['Authorization: Bearer <customer_access_token>'],
      successMessage: 'Profil pelanggan berhasil diambil',
      successData: customerProfileExample,
      errors: [
        customerAuthError,
        {
          status: 404,
          description: 'Customer pada token tidak ditemukan.',
          message: 'Pelanggan tidak ditemukan'
        }
      ]
    })
  }
};
