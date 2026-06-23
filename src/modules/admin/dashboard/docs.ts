import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  uuidField
} from '../swagger';

const branchParams = t.Object({
  branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId)
});

const todayDashboardExample = {
  total_appointments: 32,
  booking_count: 12,
  walk_in_count: 20,
  total_completed: 25,
  total_cancelled: 2,
  revenue: {
    total: 2500000,
    service: 2250000,
    product: 150000,
    tip: 100000
  },
  shares: {
    barber: 1500000,
    branch: 625000,
    hq: 375000
  }
};

const branchSummaryExample = [
  {
    id: '68686868-6868-4686-8686-686868686868',
    branch_id: ADMIN_EXAMPLES.branchId,
    summary_date: '2026-06-20',
    total_revenue: 2500000,
    total_appointments: 32,
    walk_in_count: 20,
    booking_count: 12,
    no_show_count: 1,
    hq_share_total: 375000,
    branch_share_total: 625000,
    created_at: '2026-06-20T23:59:00.000Z',
    updated_at: '2026-06-20T23:59:00.000Z'
  }
];

const branchSummaryDetail = (summary: string, description: string) => ({
  params: branchParams,
  detail: adminDetail({
    tag: ADMIN_TAGS.dashboard,
    summary,
    description,
    required: ['path branchId', 'Authorization: Bearer <access_token>', 'scope cabang'],
    optional: [],
    successMessage: 'Summary Cabang',
    successData: branchSummaryExample,
    errors: commonAuthErrors
  })
});

export const dashboardDocs = {
  adminToday: {
    params: branchParams,
    detail: adminDetail({
      tag: ADMIN_TAGS.dashboard,
      summary: 'Dashboard Cabang Hari Ini',
      description: 'Mengambil appointment, pembayaran paid, revenue, dan pembagian komisi untuk hari berjalan menggunakan zona waktu Asia/Jakarta.',
      required: ['path branchId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successMessage: 'Dashboard Cabang Hari Ini',
      successData: todayDashboardExample,
      errors: commonAuthErrors
    })
  },
  appointmentSummary: branchSummaryDetail(
    'Riwayat Ringkasan Appointment Cabang',
    'Mengambil daily_branch_summaries cabang untuk kebutuhan grafik volume appointment dan sumber booking.'
  ),
  paymentSummary: branchSummaryDetail(
    'Riwayat Ringkasan Pembayaran Cabang',
    'Mengambil daily_branch_summaries cabang untuk kebutuhan grafik revenue harian.'
  ),
  commissionSummary: branchSummaryDetail(
    'Riwayat Ringkasan Komisi Cabang',
    'Mengambil daily_branch_summaries cabang untuk kebutuhan grafik pembagian cabang dan HQ.'
  ),
  hqToday: {
    detail: adminDetail({
      tag: ADMIN_TAGS.hqDashboard,
      summary: 'Dashboard Global Hari Ini',
      description: 'Mengambil metrik konsolidasi seluruh cabang pada hari berjalan.',
      required: ['Authorization: Bearer <access_token>', "role 'super_admin'"],
      optional: [],
      successMessage: 'Dashboard Global Hari Ini',
      successData: todayDashboardExample,
      errors: commonAuthErrors
    })
  },
  hqSummary: {
    detail: adminDetail({
      tag: ADMIN_TAGS.hqDashboard,
      summary: 'Ringkasan Seluruh Cabang',
      description: 'Mengambil daily_branch_summaries seluruh cabang beserta nama cabang.',
      required: ['Authorization: Bearer <access_token>', "role 'super_admin'"],
      optional: [],
      successMessage: 'Summary Seluruh Cabang',
      successData: [
        {
          ...branchSummaryExample[0],
          branches: { name: 'Bomb Barbershop Jakarta Ancol' }
        }
      ],
      errors: commonAuthErrors
    })
  }
};
