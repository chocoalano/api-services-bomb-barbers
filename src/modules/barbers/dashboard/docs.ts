import {
  BARBER_EXAMPLES,
  BARBER_TAGS,
  barberAuthError,
  barberDetail,
  barberRoleError,
  barberServerError
} from '../swagger';

const currentOrderExample = {
  id: BARBER_EXAMPLES.appointmentId,
  customer_name: 'Budi Santoso',
  service_name: 'Haircut',
  price: 85000,
  distance: '2.4 km',
  eta: '18 menit',
  time: '10:00',
  address: 'Jl. Senopati No. 88, Jakarta Selatan',
  status: 'accepted',
  raw_status: 'confirmed'
};

const todayExample = {
  pending_orders: 2,
  active_orders: 1,
  completed_today: 5,
  rating: 4.85,
  current_order: currentOrderExample,
  total_appointments: 8,
  total_completed: 5,
  heads_count: 5,
  commission_earned: 300000,
  tips_earned: 50000,
  total_earnings: 300000
};

const dailyStatsExample = [
  {
    id: BARBER_EXAMPLES.dailyStatId,
    barber_id: BARBER_EXAMPLES.barberId,
    branch_id: BARBER_EXAMPLES.branchId,
    summary_date: '2026-06-20',
    heads_count: 5,
    commission_earned: 300000,
    created_at: '2026-06-20T16:00:00.000Z',
    updated_at: '2026-06-20T16:00:00.000Z'
  }
];

const protectedDashboardErrors = [
  barberAuthError,
  barberRoleError,
  barberServerError
];

export const dashboardDocs = {
  barberToday: {
    detail: barberDetail({
      tag: BARBER_TAGS.dashboard,
      summary: 'Dashboard Barber Hari Ini',
      description: 'Mengambil metrik hari berjalan dalam zona waktu Asia/Jakarta. current_order dipilih berdasarkan prioritas in_service, in_queue, confirmed, lalu pending; setelah itu berdasarkan posisi antrean dan jadwal.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Dashboard Barber Hari Ini',
      successData: todayExample,
      errors: protectedDashboardErrors
    })
  },

  barberStats: {
    detail: barberDetail({
      tag: BARBER_TAGS.dashboard,
      summary: 'Statistik Harian Barber',
      description: 'Mengambil histori barber_daily_stats milik barber yang sedang login, diurutkan dari summary_date terbaru. Nominal commission_earned menggunakan rupiah penuh.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Statistik Barber',
      successData: dailyStatsExample,
      errors: protectedDashboardErrors
    })
  },

  barberEarnings: {
    detail: barberDetail({
      tag: BARBER_TAGS.dashboard,
      summary: 'Riwayat Pendapatan Barber',
      description: 'Mengambil data pendapatan harian barber. Implementasi saat ini menggunakan sumber barber_daily_stats yang sama dengan endpoint statistik, sehingga response berisi summary_date, heads_count, dan commission_earned.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Statistik Barber',
      successData: dailyStatsExample,
      errors: protectedDashboardErrors
    })
  },

  staffTodayAlias: {
    detail: barberDetail({
      tag: BARBER_TAGS.dashboard,
      summary: 'Alias Staff: Dashboard Barber Hari Ini',
      description: 'Alias kompatibilitas GET /api/v1/staff/dashboard/today. Response dan otorisasi identik dengan GET /api/v1/barber/dashboard/today dan tetap mewajibkan profil barber.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Dashboard Barber Hari Ini',
      successData: todayExample,
      errors: protectedDashboardErrors
    })
  },

  staffStatsAlias: {
    detail: barberDetail({
      tag: BARBER_TAGS.dashboard,
      summary: 'Alias Staff: Statistik Harian Barber',
      description: 'Alias kompatibilitas GET /api/v1/staff/stats/daily. Response identik dengan endpoint statistik barber.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Statistik Barber',
      successData: dailyStatsExample,
      errors: protectedDashboardErrors
    })
  },

  staffEarningsAlias: {
    detail: barberDetail({
      tag: BARBER_TAGS.dashboard,
      summary: 'Alias Staff: Pendapatan Barber',
      description: 'Alias kompatibilitas GET /api/v1/staff/earnings. Response identik dengan endpoint pendapatan barber.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Statistik Barber',
      successData: dailyStatsExample,
      errors: protectedDashboardErrors
    })
  }
};
