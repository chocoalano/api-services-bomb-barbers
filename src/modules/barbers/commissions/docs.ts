import {
  BARBER_EXAMPLES,
  BARBER_TAGS,
  barberAuthError,
  barberDetail,
  barberRoleError,
  barberServerError
} from '../swagger';

export const commissionDocs = {
  getBarberCommissions: {
    detail: barberDetail({
      tag: BARBER_TAGS.commissions,
      summary: 'Laporan Komisi Harian Barber',
      description: 'Mengambil histori barber_daily_stats berdasarkan profil barber pada token staff. Data diurutkan dari tanggal terbaru dan hanya berisi statistik milik barber yang sedang login.',
      required: ['Authorization: Bearer <barber_access_token>'],
      successMessage: 'Laporan Komisi Barber Harian',
      successData: [
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
      ],
      errors: [
        barberAuthError,
        barberRoleError,
        {
          status: 403,
          description: 'Staff tidak memiliki profil barber.',
          message: 'Profil barber tidak ditemukan'
        },
        barberServerError
      ]
    })
  }
};
