import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  isoDateTimeField,
  uuidField
} from '../swagger';

const exportErrors = [
  ...commonAuthErrors,
  {
    status: 500,
    description: 'Data export gagal dibaca atau dibentuk menjadi CSV.',
    message: 'Internal Server Error'
  }
];

export const analyticsDocs = {
  getBranchesAnalytics: {
    detail: adminDetail({
      tag: ADMIN_TAGS.analytics,
      summary: 'Analytics Seluruh Cabang',
      description: 'Mengambil maksimal 100 daily branch summaries terbaru beserta nama cabang.',
      required: ['Authorization: Bearer <access_token>', "role 'super_admin'"],
      optional: [],
      successMessage: 'Berhasil mengambil data analytics',
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
          branch: { name: 'Bomb Barbershop Jakarta Ancol' }
        }
      ],
      errors: exportErrors
    })
  },
  exportRevenue: {
    query: t.Object({
      start_date: t.Optional(isoDateTimeField(
        'Batas awal created_at invoice, format ISO 8601.',
        '2026-06-01T00:00:00.000Z'
      )),
      end_date: t.Optional(isoDateTimeField(
        'Batas akhir created_at invoice, format ISO 8601.',
        '2026-06-30T23:59:59.000Z'
      )),
      branch_id: t.Optional(uuidField(
        'Filter UUID cabang.',
        ADMIN_EXAMPLES.branchId
      ))
    }, {
      examples: [
        {},
        {
          start_date: '2026-06-01T00:00:00.000Z',
          end_date: '2026-06-30T23:59:59.000Z',
          branch_id: ADMIN_EXAMPLES.branchId
        }
      ]
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.analytics,
      summary: 'Export Revenue CSV',
      description: 'Mengunduh data invoice dan revenue dalam format CSV. Seluruh filter bersifat opsional dan dapat dikombinasikan.',
      required: ['Authorization: Bearer <access_token>', "role 'super_admin'"],
      optional: ['start_date', 'end_date', 'branch_id'],
      contentType: 'text/csv',
      rawSuccessExample: `Invoice ID,Appointment ID,Branch Name,Total Amount,Created At
79797979-7979-4797-8797-797979797979,${ADMIN_EXAMPLES.appointmentId},Bomb Barbershop Jakarta Ancol,95000,2026-06-20T11:05:00.000Z`,
      successDescription: 'File revenue_export.csv berhasil dibuat.',
      errors: exportErrors
    })
  },
  exportCommission: {
    query: t.Object({
      start_date: t.Optional(isoDateTimeField(
        'Batas awal created_at commission entry.',
        '2026-06-01T00:00:00.000Z'
      )),
      end_date: t.Optional(isoDateTimeField(
        'Batas akhir created_at commission entry.',
        '2026-06-30T23:59:59.000Z'
      )),
      barber_id: t.Optional(uuidField(
        'Filter UUID barber.',
        ADMIN_EXAMPLES.barberId
      ))
    }, {
      examples: [
        {},
        {
          start_date: '2026-06-01T00:00:00.000Z',
          end_date: '2026-06-30T23:59:59.000Z',
          barber_id: ADMIN_EXAMPLES.barberId
        }
      ]
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.analytics,
      summary: 'Export Komisi CSV',
      description: 'Mengunduh data komisi barber dalam format CSV. Seluruh filter bersifat opsional.',
      required: ['Authorization: Bearer <access_token>', "role 'super_admin'"],
      optional: ['start_date', 'end_date', 'barber_id'],
      contentType: 'text/csv',
      rawSuccessExample: `ID,Barber Name,Base Amount,Barber Share,Tip,Created At
${ADMIN_EXAMPLES.commissionId},Budi Santoso,75000,50000,5000,2026-06-20T11:10:00.000Z`,
      successDescription: 'File commission_export.csv berhasil dibuat.',
      errors: exportErrors
    })
  }
};
