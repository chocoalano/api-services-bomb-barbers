import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonMutationErrors,
  isoDateField,
  requestExamples,
  uuidField
} from '../swagger';

const expenseExample = {
  id: ADMIN_EXAMPLES.expenseId,
  branch_id: ADMIN_EXAMPLES.branchId,
  amount: 350000,
  description: 'Pembelian bahan kebersihan dan handuk.',
  expense_date: '2026-06-20',
  created_at: '2026-06-20T09:00:00.000Z',
  updated_at: '2026-06-20T09:00:00.000Z'
};

export const expenseDocs = {
  adminGetExpenses: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.expenses,
      summary: 'Daftar Pengeluaran Cabang',
      description: 'Mengambil seluruh pengeluaran cabang dari tanggal pengeluaran terbaru.',
      required: ['path branchId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successMessage: 'Berhasil mengambil data pengeluaran',
      successData: [expenseExample],
      errors: commonMutationErrors
    })
  },
  adminCreateExpense: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId)
    }),
    body: t.Object({
      amount: t.Integer({
        minimum: 1,
        description: 'Nominal pengeluaran dalam rupiah penuh.',
        examples: [350000]
      }),
      description: t.String({
        minLength: 3,
        maxLength: 1000,
        description: 'Keterangan pengeluaran.',
        examples: ['Pembelian bahan kebersihan dan handuk.']
      }),
      expense_date: isoDateField('Tanggal transaksi pengeluaran.', '2026-06-20')
    }, requestExamples(
      {
        amount: 350000,
        description: 'Pembelian bahan kebersihan dan handuk.',
        expense_date: '2026-06-20'
      },
      {
        amount: 350000,
        description: 'Pembelian bahan kebersihan dan handuk.',
        expense_date: '2026-06-20'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.expenses,
      summary: 'Catat Pengeluaran Cabang',
      description: 'Mencatat pengeluaran operasional pada cabang yang berada dalam scope admin.',
      required: ['path branchId', 'amount', 'description', 'expense_date', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successStatus: 201,
      successMessage: 'Pengeluaran berhasil dicatat',
      successData: expenseExample,
      errors: commonMutationErrors
    })
  },
  adminUpdateExpense: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId),
      expenseId: uuidField('UUID pengeluaran.', ADMIN_EXAMPLES.expenseId)
    }),
    body: t.Object({
      amount: t.Optional(t.Integer({
        minimum: 1,
        description: 'Nominal baru dalam rupiah penuh.',
        examples: [400000]
      })),
      description: t.Optional(t.String({
        minLength: 3,
        maxLength: 1000,
        examples: ['Pembelian bahan kebersihan, handuk, dan sarung barber.']
      })),
      expense_date: t.Optional(isoDateField('Tanggal pengeluaran baru.', '2026-06-21'))
    }, requestExamples(
      { amount: 400000 },
      {
        amount: 400000,
        description: 'Pembelian bahan kebersihan, handuk, dan sarung barber.',
        expense_date: '2026-06-21'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.expenses,
      summary: 'Perbarui Pengeluaran Cabang',
      description: 'Memperbarui satu atau beberapa atribut pengeluaran dengan tetap memastikan expense berasal dari cabang pada path.',
      required: ['path branchId', 'path expenseId', 'minimal satu field body', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: ['amount', 'description', 'expense_date'],
      successMessage: 'Pengeluaran berhasil diubah',
      successData: { ...expenseExample, amount: 400000 },
      errors: commonMutationErrors
    })
  },
  adminDeleteExpense: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId),
      expenseId: uuidField('UUID pengeluaran.', ADMIN_EXAMPLES.expenseId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.expenses,
      summary: 'Hapus Pengeluaran Cabang',
      description: 'Menghapus pengeluaran berdasarkan expenseId dan branchId.',
      required: ['path branchId', 'path expenseId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successMessage: 'Pengeluaran berhasil dihapus',
      successData: null,
      errors: commonMutationErrors
    })
  }
};
