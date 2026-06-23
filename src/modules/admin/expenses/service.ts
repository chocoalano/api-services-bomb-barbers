import { supabase } from '../../../lib/supabase';

export class ExpenseService {
  async getExpenses(branchId: string) {
    const { data, error } = await supabase
      .from('branch_expenses')
      .select('*')
      .eq('branch_id', branchId)
      .order('expense_date', { ascending: false });
    
    if (error) throw new Error(error.message);
    return data;
  }

  async createExpense(branchId: string, payload: { amount: number, description: string, expense_date: string }) {
    const { data, error } = await supabase
      .from('branch_expenses')
      .insert({
        branch_id: branchId,
        amount: payload.amount,
        description: payload.description,
        expense_date: payload.expense_date
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateExpense(branchId: string, expenseId: string, payload: { amount?: number, description?: string, expense_date?: string }) {
    const { data, error } = await supabase
      .from('branch_expenses')
      .update(payload)
      .eq('id', expenseId)
      .eq('branch_id', branchId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteExpense(branchId: string, expenseId: string) {
    const { error } = await supabase
      .from('branch_expenses')
      .delete()
      .eq('id', expenseId)
      .eq('branch_id', branchId);
    
    if (error) throw new Error(error.message);
    return true;
  }
}
