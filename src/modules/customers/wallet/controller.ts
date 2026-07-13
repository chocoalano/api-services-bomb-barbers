import { randomUUID } from 'crypto';
import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { db } from '../../../lib/db';
import { customerWallets, customerWalletTransactions, customerWithdrawals } from '../../../db/schema';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { asRpcResult, debitCustomerWallet } from '../../../db/procedures';
import { TopupService } from '../../../core/wallets/topup.service';
import { TipService } from '../../../core/wallets/tip.service';

export class CustomerWalletController {
  static async getWallet({ customerId, set }: any) {
    try {
      // Buat wallet jika belum ada (customer lama sebelum migration)
      await db
        .insert(customerWallets)
        .values({ id: randomUUID(), customerId, balance: '0' })
        .onDuplicateKeyUpdate({ set: { customerId } });

      const [wallet] = await db
        .select({ id: customerWallets.id, balance: customerWallets.balance, updated_at: customerWallets.updatedAt })
        .from(customerWallets)
        .where(eq(customerWallets.customerId, customerId))
        .limit(1);

      if (!wallet) {
        set.status = 404;
        return createErrorResponse('Wallet tidak ditemukan');
      }

      const transactions = await db
        .select({
          id: customerWalletTransactions.id,
          amount: customerWalletTransactions.amount,
          type: customerWalletTransactions.type,
          description: customerWalletTransactions.description,
          created_at: customerWalletTransactions.createdAt
        })
        .from(customerWalletTransactions)
        .where(eq(customerWalletTransactions.walletId, wallet.id))
        .orderBy(desc(customerWalletTransactions.createdAt))
        .limit(30);

      return createSuccessResponse('Wallet berhasil dimuat', {
        balance: Number(wallet.balance),
        updated_at: wallet.updated_at,
        transactions: (transactions ?? []).map(t => ({
          id: t.id,
          amount: Number(t.amount),
          type: t.type,
          description: t.description,
          created_at: t.created_at
        }))
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async requestWithdraw({ customerId, body, set }: any) {
    try {
      const amount = Number(body?.amount ?? 0);
      const bankName = (body?.bank_name ?? '').trim();
      const accountNumber = (body?.account_number ?? '').trim();
      const accountName = (body?.account_name ?? '').trim();

      if (amount <= 0) {
        set.status = 400;
        return createErrorResponse('Jumlah penarikan harus lebih dari 0');
      }
      if (!bankName || !accountNumber || !accountName) {
        set.status = 400;
        return createErrorResponse('Nama bank, nomor rekening, dan nama pemilik rekening wajib diisi');
      }

      // Cek saldo
      const [wallet] = await db
        .select({ id: customerWallets.id, balance: customerWallets.balance })
        .from(customerWallets)
        .where(eq(customerWallets.customerId, customerId))
        .limit(1);

      if (!wallet || Number(wallet.balance) < amount) {
        set.status = 400;
        return createErrorResponse('Saldo tidak mencukupi untuk melakukan penarikan');
      }

      // Kurangi saldo + catat transaksi via RPC atomic
      const { error: debitErr } = await asRpcResult(() =>
        debitCustomerWallet({
          customerId,
          amount,
          type: 'withdrawal_pending',
          description: `Permintaan penarikan ke ${bankName} ${accountNumber}`
        })
      );

      if (debitErr) throw new Error(debitErr.message);

      // Simpan withdrawal request
      const withdrawalId = randomUUID();
      await db.insert(customerWithdrawals).values({
        id: withdrawalId,
        customerId,
        amount: String(amount),
        bankName,
        accountNumber,
        accountName
      });
      const [withdrawal] = await db
        .select({ id: customerWithdrawals.id, status: customerWithdrawals.status, created_at: customerWithdrawals.createdAt })
        .from(customerWithdrawals)
        .where(eq(customerWithdrawals.id, withdrawalId))
        .limit(1);

      // Update reference_id di wallet transaction — ambil row terbaru dulu, baru update by id
      if (withdrawal) {
        const [latestTx] = await db
          .select({ id: customerWalletTransactions.id })
          .from(customerWalletTransactions)
          .where(
            and(
              eq(customerWalletTransactions.walletId, wallet.id),
              eq(customerWalletTransactions.type, 'withdrawal_pending'),
              isNull(customerWalletTransactions.referenceId)
            )
          )
          .orderBy(desc(customerWalletTransactions.createdAt))
          .limit(1);

        if (latestTx) {
          await db
            .update(customerWalletTransactions)
            .set({ referenceId: withdrawal.id })
            .where(eq(customerWalletTransactions.id, latestTx.id));
        }
      }

      return createSuccessResponse('Permintaan penarikan berhasil diajukan. Tim kami akan memproses dalam 1-3 hari kerja.', {
        withdrawal_id: withdrawal?.id,
        amount,
        status: 'pending'
      });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  /** Inisiasi top-up saldo via payment gateway (Midtrans). */
  static async createTopup({ customerId, body, set }: any) {
    try {
      const result = await TopupService.createTopup(customerId, {
        amount: Number(body?.amount ?? 0),
        provider: body?.provider,
        method: body?.method
      });
      set.status = 201;
      return createSuccessResponse('Top-up diinisiasi. Selesaikan pembayaran.', result);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  /** Konfirmasi top-up setelah WebView Midtrans sukses (verifikasi + kredit saldo). */
  static async confirmTopup({ customerId, params, set }: any) {
    try {
      const result = await TopupService.confirmTopup(customerId, params.id);
      return createSuccessResponse('Status top-up diperbarui', result);
    } catch (err: any) {
      set.status = err.status || 500;
      return createErrorResponse(err.message);
    }
  }

  /** Bayar tip barber dari saldo wallet customer. */
  static async payTip({ customerId, body, set }: any) {
    try {
      const result = await TipService.payTip(
        customerId,
        String(body?.appointment_id ?? ''),
        Number(body?.amount ?? 0)
      );
      return createSuccessResponse('Tip berhasil dibayar dari saldo', result);
    } catch (err: any) {
      set.status = err.status || 400;
      // Sisipkan kode agar klien bisa mengenali saldo kurang → arahkan top-up.
      return createErrorResponse(err.message, err.code ? { code: err.code } : undefined);
    }
  }
}
