import { t } from 'elysia';

const paginationQuery = {
  limit: t.Optional(t.Numeric({
    minimum: 1,
    maximum: 100,
    description: 'Jumlah maksimal data yang ingin diambil. Jika tidak dikirim, backend memakai nilai default yang aman untuk aplikasi mobile.'
  }))
};

export const contentDocs = {
  getBanners: {
    query: t.Object({
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 30,
        description: 'Jumlah maksimal banner yang ingin ditampilkan di aplikasi. Default backend adalah 10 dan batas maksimal adalah 30.'
      }))
    }),
    detail: {
      tags: ['Customer Content'],
      summary: 'Daftar Banner Aktif',
      description: 'Endpoint ini digunakan oleh aplikasi pelanggan untuk mengambil banner promosi yang masih aktif. Backend hanya mengembalikan banner yang belum dihapus, memiliki gambar, berstatus aktif, dan berada dalam periode tampil berdasarkan starts_at dan ends_at. Data ini cocok dipakai untuk carousel atau banner utama di halaman beranda aplikasi Bomb Barbershop.'
    }
  },
  getGallery: {
    query: t.Object({
      ...paginationQuery,
      barber_id: t.Optional(t.String({
        description: 'UUID barber. Jika dikirim, gallery hanya mengambil portfolio dari barber tersebut.'
      })),
      branch_id: t.Optional(t.String({
        description: 'UUID cabang. Jika dikirim, gallery hanya mengambil portfolio dari barber yang berada di cabang tersebut.'
      }))
    }),
    detail: {
      tags: ['Customer Content'],
      summary: 'Gallery Hasil Layanan',
      description: 'Endpoint ini mengambil gallery hasil layanan dari tabel barber_portfolios yang sudah tersedia di backend. Setiap gambar pada portfolio barber dianggap sebagai gambar hasil akhir atau after dari pekerjaan barber. Backend hanya mengembalikan portfolio milik barber yang belum dihapus, dan dapat difilter berdasarkan barber_id atau branch_id jika aplikasi perlu menampilkan gallery per barber atau per cabang.'
    }
  },
  getCustomerNotifications: {
    query: t.Object({
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 50,
        description: 'Jumlah maksimal notifikasi yang ingin diambil. Default backend adalah 20 dan batas maksimal adalah 50.'
      })),
      unread_only: t.Optional(t.BooleanString({
        description: 'Jika bernilai true, backend hanya mengembalikan notifikasi pelanggan yang belum dibaca.'
      })),
      before: t.Optional(t.String({
        description: 'Timestamp ISO untuk pagination mundur. Kirim created_at terakhir dari halaman sebelumnya agar backend mengambil notifikasi yang lebih lama.'
      }))
    }),
    detail: {
      tags: ['Customer Content'],
      summary: 'Daftar Notifikasi Pelanggan',
      description: 'Endpoint ini digunakan untuk mengambil notifikasi milik pelanggan yang sedang login. Backend membaca token customer, membatasi hasil hanya untuk recipient_type customer dan recipient_id pelanggan tersebut, lalu mengembalikan daftar notifikasi beserta unread_count. Endpoint ini cocok untuk halaman notification center dan badge jumlah notifikasi belum dibaca di aplikasi pelanggan.'
    }
  }
};
