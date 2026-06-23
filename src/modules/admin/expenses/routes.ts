import { Elysia } from 'elysia';
import { ExpenseController } from './controller';
import { expenseDocs } from './docs';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope, requirePermission } from '../../../middleware/rbac';

export const expenseRoutes = new Elysia({ prefix: '/api/v1/admin/expenses/branches/:branchId' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requireBranchScope((ctx: any) => ctx.params?.branchId))
  // Baca pengeluaran: cukup branch scope
  .get('/', ExpenseController.getAll, expenseDocs.adminGetExpenses)
  // Mutasi pengeluaran: butuh manage_payment (data finansial)
  .post('/', ExpenseController.create, { ...expenseDocs.adminCreateExpense, beforeHandle: requirePermission('manage_payment') })
  .put('/:expenseId', ExpenseController.update, { ...expenseDocs.adminUpdateExpense, beforeHandle: requirePermission('manage_payment') })
  .delete('/:expenseId', ExpenseController.delete, { ...expenseDocs.adminDeleteExpense, beforeHandle: requirePermission('manage_payment') });
