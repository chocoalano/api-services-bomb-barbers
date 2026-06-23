import { supabase } from '../lib/supabase';

/**
 * Kumpulan resolver async untuk dipakai bersama `requireBranchScopeResolved`.
 * Setiap resolver mengembalikan `branch_id` dari resource yang dirujuk request,
 * atau `null` jika resource tidak ditemukan.
 */

/** Resolve branch_id dari appointment via param `:id`. */
export const appointmentBranchResolver = async (ctx: any): Promise<string | null> => {
  const { data } = await supabase
    .from('appointments')
    .select('branch_id')
    .eq('id', ctx.params.id)
    .single();
  return data?.branch_id ?? null;
};

/** Resolve branch_id dari payment via param `:id`. */
export const paymentBranchResolver = async (ctx: any): Promise<string | null> => {
  const { data } = await supabase
    .from('payments')
    .select('branch_id')
    .eq('id', ctx.params.id)
    .single();
  return data?.branch_id ?? null;
};
