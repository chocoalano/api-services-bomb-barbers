import { t } from 'elysia';

export const chatDocs = {
  getChatHistory: {
    params: t.Object({ id: t.String() }),
    query: t.Object({
      page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 }))
    }),
    detail: {
      tags: ['Live Chat'],
      summary: 'Ambil Riwayat Chat Appointment',
      description: 'Mengambil riwayat pesan chat untuk appointment tertentu. Endpoint ini dapat digunakan oleh pelanggan atau barber yang memang menjadi peserta appointment. Data diurutkan dari pesan paling lama ke pesan terbaru, dengan pagination agar layar chat dapat memuat riwayat secara bertahap sebelum realtime/WebSocket aktif.'
    }
  },
  sendMessage: {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      text: t.Optional(t.String({
        minLength: 1,
        description: 'Isi pesan yang dikirim. Field ini direkomendasikan untuk aplikasi baru.'
      })),
      message: t.Optional(t.String({
        minLength: 1,
        description: 'Alias isi pesan untuk kompatibilitas aplikasi mobile yang sudah memakai nama field message.'
      }))
    }),
    detail: {
      tags: ['Live Chat'],
      summary: 'Kirim Pesan Chat Appointment',
      description: 'Menyimpan pesan chat baru untuk appointment tertentu. Backend memvalidasi bahwa pengirim adalah pelanggan pemilik appointment atau staff barber yang ditugaskan, lalu menyimpan pesan ke tabel chat_messages. Endpoint REST ini dapat dipakai sebagai fallback atau pendamping sebelum notifikasi realtime diaktifkan.'
    }
  }
};
