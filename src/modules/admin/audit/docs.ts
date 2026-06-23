import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  uuidField
} from '../swagger';

export const auditDocs = {
  getLogs: {
    query: t.Object({
      entity_type: t.Optional(t.String({
        description: 'Filter jenis entitas, misalnya payments, appointments, atau barbers.',
        examples: ['payments']
      })),
      entity_id: t.Optional(uuidField(
        'Filter UUID entitas tertentu.',
        ADMIN_EXAMPLES.paymentId
      )),
      branch_id: t.Optional(uuidField(
        'Filter log berdasarkan UUID cabang. Berguna untuk branch admin melihat aktivitas cabangnya.',
        ADMIN_EXAMPLES.branchId
      )),
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 500,
        default: 50,
        description: 'Jumlah maksimal audit log. Default 50.',
        examples: [100]
      })),
      offset: t.Optional(t.Numeric({
        minimum: 0,
        default: 0,
        description: 'Jumlah record yang dilewati. Gunakan bersama limit untuk paginasi offset. Default 0.',
        examples: [50]
      }))
    }, {
      examples: [
        {},
        {
          entity_type: 'payments',
          entity_id: ADMIN_EXAMPLES.paymentId,
          branch_id: ADMIN_EXAMPLES.branchId,
          limit: 100,
          offset: 0
        }
      ]
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.audit,
      summary: 'Daftar Audit Log',
      description: 'Mengambil rekam jejak perubahan data dari yang terbaru. Semua filter dapat dipakai bersama-sama. Filter branch_id menampilkan log yang terkait dengan cabang tertentu. Response meta menyertakan total, limit, dan offset untuk paginasi.',
      required: ['Authorization: Bearer <access_token>', "permission 'view_audit_log'"],
      optional: ['entity_type', 'entity_id', 'branch_id', 'limit', 'offset'],
      successMessage: 'Audit logs berhasil diambil',
      successData: [
        {
          id: ADMIN_EXAMPLES.auditId,
          actor_type: 'admin',
          actor_id: ADMIN_EXAMPLES.staffId,
          action: 'SET_BARBER_STATUS',
          entity_type: 'barbers',
          entity_id: ADMIN_EXAMPLES.barberId,
          branch_id: ADMIN_EXAMPLES.branchId,
          before: null,
          after: { status: 'offline' },
          created_at: '2026-06-22T10:05:00.000Z'
        }
      ],
      errors: commonAuthErrors
    })
  }
};
