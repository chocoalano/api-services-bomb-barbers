import { ExpenseService } from './service';
import { createSuccessResponse, createErrorResponse } from '../../../shared/response';

const service = new ExpenseService();

export class ExpenseController {
  static async getAll(ctx: any) {
    try {
      const { branchId } = ctx.params;
      const data = await service.getExpenses(branchId);
      return createSuccessResponse('Berhasil mengambil data pengeluaran', data);
    } catch (e: any) {
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async create(ctx: any) {
    try {
      const { branchId } = ctx.params;
      const data = await service.createExpense(branchId, ctx.body);
      ctx.set.status = 201;
      return createSuccessResponse('Pengeluaran berhasil dicatat', data);
    } catch (e: any) {
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async update(ctx: any) {
    try {
      const { branchId, expenseId } = ctx.params;
      const data = await service.updateExpense(branchId, expenseId, ctx.body);
      return createSuccessResponse('Pengeluaran berhasil diubah', data);
    } catch (e: any) {
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async delete(ctx: any) {
    try {
      const { branchId, expenseId } = ctx.params;
      await service.deleteExpense(branchId, expenseId);
      return createSuccessResponse('Pengeluaran berhasil dihapus', null);
    } catch (e: any) {
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }
}
