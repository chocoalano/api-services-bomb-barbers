import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonMutationErrors,
  uuidField
} from '../swagger';

const commissionExample = {
  id: ADMIN_EXAMPLES.commissionId,
  appointment_id: ADMIN_EXAMPLES.appointmentId,
  commission_rule_id: '67676767-6767-4676-8676-676767676767',
  base_amount: 75000,
  barber_share: 50000,
  branch_share: 18750,
  hq_share: 11250,
  tip_amount: 5000,
  calculated_at: '2026-06-20T11:10:00.000Z',
  created_at: '2026-06-20T11:10:00.000Z'
};

export const commissionDocs = {
  calculateCommission: {
    params: t.Object({
      id: uuidField('UUID appointment yang komisinya akan dihitung.', ADMIN_EXAMPLES.appointmentId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.commissions,
      summary: 'Hitung Komisi Appointment',
      description: 'Menghitung pembagian barber, cabang, dan HQ menggunakan rule paling spesifik. Appointment wajib sudah memiliki payment paid.',
      required: ['path id', 'payment berstatus paid', 'barber pada appointment', 'Authorization: Bearer <access_token>', 'scope cabang appointment'],
      optional: [],
      successStatus: 201,
      successMessage: 'Komisi berhasil dihitung',
      successData: commissionExample,
      errors: [
        ...commonMutationErrors,
        {
          status: 409,
          description: 'Komisi appointment sudah pernah dihitung.',
          message: 'Komisi untuk pesanan ini sudah pernah dihitung (Idempotency Protection)'
        }
      ]
    })
  },
  getCommissionDetail: {
    params: t.Object({
      id: uuidField('UUID appointment.', ADMIN_EXAMPLES.appointmentId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.commissions,
      summary: 'Detail Komisi Appointment',
      description: 'Mengambil commission entry beserta commission rule yang digunakan.',
      required: ['path id', 'Authorization: Bearer <access_token>', 'scope cabang appointment'],
      optional: [],
      successMessage: 'Detail komisi',
      successData: {
        ...commissionExample,
        commission_rules: {
          id: '67676767-6767-4676-8676-676767676767',
          scope: 'barber',
          scope_ref_id: ADMIN_EXAMPLES.barberId,
          barber_pct: 60,
          branch_pct: 25,
          hq_pct: 15,
          tip_to_barber: true,
          effective_from: '2026-01-01T00:00:00.000Z',
          effective_to: null
        }
      },
      errors: [
        ...commonMutationErrors,
        {
          status: 404,
          description: 'Komisi belum dihitung atau appointment tidak ditemukan.',
          message: 'Data komisi tidak ditemukan'
        }
      ]
    })
  },
  getBranchCommissions: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.commissions,
      summary: 'Laporan Komisi Cabang',
      description: 'Mengambil ringkasan revenue dan pembagian hasil cabang per tanggal, diurutkan dari tanggal terbaru.',
      required: ['path branchId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successMessage: 'Laporan Bagi Hasil Cabang',
      successData: [
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
      ],
      errors: commonMutationErrors
    })
  }
};
