import { t } from 'elysia';

export const staffAuthDocs = {
  login: {
    body: t.Object({
      email: t.String({ 
        format: 'email',
        description: 'Alamat email staff yang valid'
      }),
      password: t.String({ description: 'Kata sandi akun staff' })
    }),
    detail: {
      tags: ['Staff Auth'],
      summary: 'Login Staff',
      description: 'Endpoint ini digunakan untuk autentikasi staff / karyawan barbershop. Jika berhasil, sistem akan mengembalikan access token dan refresh token.'
    }
  },
  refresh: {
    body: t.Object({
      refreshToken: t.String({ description: 'Refresh token yang masih valid' })
    }),
    detail: {
      tags: ['Staff Auth'],
      summary: 'Refresh Token Staff',
      description: 'Endpoint ini digunakan untuk memperbarui access token staff yang sudah kedaluwarsa menggunakan refresh token.'
    }
  },
  logout: {
    detail: {
      tags: ['Staff Auth'],
      summary: 'Logout Staff',
      description: 'Melakukan proses logout dari sisi server untuk staff.'
    }
  },
  getProfile: {
    detail: {
      tags: ['Staff Profile'],
      summary: 'Ambil Profil Staff atau Barber yang Sedang Login',
      description: 'Endpoint ini membutuhkan JWT staff pada header Authorization. Response berisi data profil staff yang sedang login dan, jika staff tersebut memiliki profil barber, backend juga mengembalikan field ringkas untuk Dashboard Barber di level data utama: name sebagai nama tampil barber, branch_area sebagai cabang atau area operasional, radius_km sebagai radius penerimaan order, rating_avg sebagai rating rata-rata, dan rating_count sebagai jumlah ulasan. Objek barber tetap disediakan untuk detail cabang dan kompatibilitas klien yang membutuhkan struktur lebih lengkap.'
    }
  }
};
