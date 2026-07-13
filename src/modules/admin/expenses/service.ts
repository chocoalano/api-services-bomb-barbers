import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { snakeKeys, camelKeys } from '../../../db/helpers';
import { branchExpenses } from '../../../db/schema';
import { and, eq, desc } from 'drizzle-orm';

export class ExpenseService {
  async getExpenses(branchId: string) {
    return snakeKeys(
      await db
        .select()
        .from(branchExpenses)
        .where(eq(branchExpenses.branchId, branchId))
        .orderBy(desc(branchExpenses.expenseDate))
    );
  }

  async createExpense(branchId: string, payload: { amount: number; description: string; expense_date: string }) {
    const id = randomUUID();
    await db.insert(branchExpenses).values({
      id,
      branchId,
      amount: payload.amount,
      description: payload.description,
      expenseDate: payload.expense_date
    });
    const [row] = snakeKeys(await db.select().from(branchExpenses).where(eq(branchExpenses.id, id)).limit(1));
    return row;
  }

  async updateExpense(
    branchId: string,
    expenseId: string,
    payload: { amount?: number; description?: string; expense_date?: string }
  ) {
    const setClause = camelKeys(
      Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined))
    );
    if (Object.keys(setClause).length > 0) {
      await db
        .update(branchExpenses)
        .set(setClause)
        .where(and(eq(branchExpenses.id, expenseId), eq(branchExpenses.branchId, branchId)));
    }
    const [row] = snakeKeys(
      await db
        .select()
        .from(branchExpenses)
        .where(and(eq(branchExpenses.id, expenseId), eq(branchExpenses.branchId, branchId)))
        .limit(1)
    );
    return row;
  }

  async deleteExpense(branchId: string, expenseId: string) {
    await db
      .delete(branchExpenses)
      .where(and(eq(branchExpenses.id, expenseId), eq(branchExpenses.branchId, branchId)));
    return true;
  }
}
