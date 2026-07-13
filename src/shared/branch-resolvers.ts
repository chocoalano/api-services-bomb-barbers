import { db } from '../lib/db';
import { appointments, payments } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Kumpulan resolver async untuk dipakai bersama `requireBranchScopeResolved`.
 * Setiap resolver mengembalikan `branch_id` dari resource yang dirujuk request,
 * atau `null` jika resource tidak ditemukan.
 */

/** Resolve branch_id dari appointment via param `:id`. */
export const appointmentBranchResolver = async (ctx: any): Promise<string | null> => {
  const [row] = await db
    .select({ branchId: appointments.branchId })
    .from(appointments)
    .where(eq(appointments.id, ctx.params.id))
    .limit(1);
  return row?.branchId ?? null;
};

/** Resolve branch_id dari payment via param `:id`. */
export const paymentBranchResolver = async (ctx: any): Promise<string | null> => {
  const [row] = await db
    .select({ branchId: payments.branchId })
    .from(payments)
    .where(eq(payments.id, ctx.params.id))
    .limit(1);
  return row?.branchId ?? null;
};
