export const dashboardDocs = {
  adminToday: { detail: { tags: ['Dashboard'], summary: 'Lihat ringkasan hari ini untuk Cabang' } },
  adminSummary: { detail: { tags: ['Dashboard'], summary: 'Lihat rekapitulasi data cabang' } },
  barberToday: {
    detail: {
      tags: ['Dashboard Barber'],
      summary: 'Ringkasan Kinerja Barber Hari Ini',
      description: 'Mengambil metrik dashboard untuk barber yang sedang login berdasarkan token staff. Response berisi pending_orders untuk order baru yang belum direspons, active_orders untuk order yang sudah diterima atau sedang dikerjakan, completed_today untuk jumlah order selesai hari ini, rating sebagai rata-rata rating barber, dan current_order sebagai order prioritas yang siap ditampilkan di kartu Current Order. current_order dipilih dari order aktif terdekat terlebih dahulu, lalu fallback ke pending terdekat agar dashboard tetap bisa menampilkan order yang membutuhkan respons. Field legacy seperti total_completed dan total_earnings tetap disediakan agar kompatibel dengan klien lama.'
    }
  },
  barberStats: { detail: { tags: ['Dashboard'], summary: 'Lihat statistik dan pendapatan Barber' } },
  hqToday: { detail: { tags: ['Dashboard'], summary: 'Lihat ringkasan hari ini untuk Pusat (Global)' } },
  hqSummary: { detail: { tags: ['Dashboard'], summary: 'Lihat rekapitulasi performa cabang nasional' } },
};
