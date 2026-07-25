import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { customerWithdrawals, customers, withdrawals, barbers, staffUsers } from '../../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { asRpcResult, approveCustomerWithdrawalAtomic, rejectCustomerWithdrawalAtomic, approveBarberWithdrawalAtomic, rejectBarberWithdrawalAtomic } from '../../../db/procedures';
import { emitWalletRefundCredited } from '../../../lib/socket';

export class AdminWithdrawalController {
  // ── Customer withdrawals ────────────────────────────────────────────────────

  static async listCustomerWithdrawals({ query, set }: any) {
    try {
      const status = query?.status ?? 'pending';
      const limit = Math.min(Number(query?.limit ?? 50), 200);

      const rows = await db
        .select({ wd: customerWithdrawals, fullName: customers.fullName, email: customers.email, phone: customers.phone })
        .from(customerWithdrawals)
        .leftJoin(customers, eq(customerWithdrawals.customerId, customers.id))
        .where(status !== 'all' ? eq(customerWithdrawals.status, status) : undefined)
        .orderBy(desc(customerWithdrawals.createdAt))
        .limit(limit);

      const data = rows.map((r) => ({
        ...snakeKeys(r.wd),
        customers: { full_name: r.fullName, email: r.email, phone: r.phone }
      }));

      return createSuccessResponse('Daftar penarikan customer', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async approveCustomerWithdrawal({ params, set }: any) {
    try {
      // Transisi status atomik: hanya sukses bila masih pending (cegah proses ganda).
      const { error: rpcErr } = await asRpcResult(() =>
        approveCustomerWithdrawalAtomic({ withdrawalId: params.id })
      );

      if (rpcErr) {
        set.status = rpcErr.code === 'P0002' ? 400 : 500;
        return createErrorResponse(rpcErr.message);
      }

      return createSuccessResponse('Penarikan berhasil disetujui dan ditandai selesai', null);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async rejectCustomerWithdrawal({ params, body, set }: any) {
    try {
      const reason = (body?.reason ?? '').trim();
      if (!reason) { set.status = 400; return createErrorResponse('Alasan penolakan wajib diisi'); }

      // Transisi status + credit-back saldo dalam satu transaksi atomik (H2).
      // Mencegah double-credit dari reject bersamaan (double-click/retry).
      const { data: result, error: rpcErr } = await asRpcResult(() =>
        rejectCustomerWithdrawalAtomic({ withdrawalId: params.id, reason })
      );

      if (rpcErr) {
        set.status = rpcErr.code === 'P0002' ? 400 : 500;
        return createErrorResponse(rpcErr.message);
      }

      // Notifikasi real-time ke customer
      emitWalletRefundCredited({
        customer_id: result?.customer_id,
        appointment_id: '',
        amount: Number(result?.amount ?? 0),
        new_balance: result?.new_balance ?? 0
      });

      return createSuccessResponse('Withdrawal ditolak dan saldo dikembalikan ke customer', null);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  // ── Barber withdrawals ──────────────────────────────────────────────────────

  static async listBarberWithdrawals({ query, set }: any) {
    try {
      const status = query?.status ?? 'pending';
      const limit = Math.min(Number(query?.limit ?? 50), 200);

      const rows = await db
        .select({ wd: withdrawals, barberId: barbers.id, staffFullName: staffUsers.fullName, staffEmail: staffUsers.email })
        .from(withdrawals)
        .leftJoin(barbers, eq(withdrawals.barberId, barbers.id))
        .leftJoin(staffUsers, eq(barbers.staffUserId, staffUsers.id))
        .where(status !== 'all' ? eq(withdrawals.status, status) : undefined)
        .orderBy(desc(withdrawals.createdAt))
        .limit(limit);

      const data = rows.map((r) => ({
        ...snakeKeys(r.wd),
        barbers: r.barberId
          ? { id: r.barberId, staff_users: { full_name: r.staffFullName, email: r.staffEmail } }
          : null
      }));

      return createSuccessResponse('Daftar penarikan barber', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async approveBarberWithdrawal({ params, set }: any) {
    try {
      const { error: rpcErr } = await asRpcResult(() =>
        approveBarberWithdrawalAtomic({ withdrawalId: params.id })
      );

      if (rpcErr) {
        set.status = rpcErr.code === 'P0002' ? 400 : 500;
        return createErrorResponse(rpcErr.message);
      }

      return createSuccessResponse('Penarikan barber berhasil disetujui', null);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  static async rejectBarberWithdrawal({ params, body, set }: any) {
    try {
      const reason = (body?.reason ?? '').trim();
      if (!reason) { set.status = 400; return createErrorResponse('Alasan penolakan wajib diisi'); }

      // Transisi status + credit-back saldo dalam satu transaksi atomik (H2, H3).
      // Menggunakan RPC (balance = balance + amount) menghindari lost-update dari
      // deposit komisi bersamaan, dan mencegah double-credit dari reject ganda.
      const { error: rpcErr } = await asRpcResult(() =>
        rejectBarberWithdrawalAtomic({ withdrawalId: params.id, reason })
      );

      if (rpcErr) {
        set.status = rpcErr.code === 'P0002' ? 400 : 500;
        return createErrorResponse(rpcErr.message);
      }

      return createSuccessResponse('Withdrawal barber ditolak dan saldo dikembalikan', null);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }
}
