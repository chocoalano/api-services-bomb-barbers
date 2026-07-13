import { randomUUID } from 'crypto';
import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { barbers, barberWallets, walletTransactions } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { asRpcResult, requestWithdrawal } from '../../db/procedures';

async function resolveBarberId(staffUserId: string): Promise<string> {
  const [barber] = await db
    .select({ id: barbers.id })
    .from(barbers)
    .where(eq(barbers.staffUserId, staffUserId))
    .limit(1);
  if (!barber) throw new Error('Data barber tidak ditemukan');
  return barber.id;
}

export class WalletService {
  /**
   * Mengambil saldo wallet barber beserta riwayat transaksinya.
   */
  static async getWalletDetails(staffUserId: string) {
    const barberId = await resolveBarberId(staffUserId);

    // Pastikan wallet ada, jika tidak ada karena race condition atau data lama, buatkan
    let [wallet] = snakeKeys(
      await db.select().from(barberWallets).where(eq(barberWallets.barberId, barberId)).limit(1)
    );

    if (!wallet) {
      const newId = randomUUID();
      await db.insert(barberWallets).values({ id: newId, barberId, balance: '0' });
      [wallet] = snakeKeys(
        await db.select().from(barberWallets).where(eq(barberWallets.id, newId)).limit(1)
      );
    }

    const transactions = snakeKeys(
      await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.walletId, wallet.id))
        .orderBy(desc(walletTransactions.createdAt))
        .limit(50)
    );

    return {
      balance: wallet.balance,
      transactions: transactions || []
    };
  }

  /**
   * Mengajukan penarikan dana (withdrawal).
   */
  static async requestWithdrawal(staffUserId: string, payload: { amount: number; bank_name: string; account_number: string; account_name: string }) {
    if (payload.amount < 50000) {
      throw new Error('Minimal penarikan dana adalah Rp 50.000');
    }

    const barberId = await resolveBarberId(staffUserId);

    const { data: result, error } = await asRpcResult(() =>
      requestWithdrawal({
        barberId,
        amount: payload.amount,
        bankName: payload.bank_name,
        accountNumber: payload.account_number,
        accountName: payload.account_name
      })
    );

    if (error) {
      if (error.message.includes('Insufficient balance')) {
        throw new Error('Saldo tidak mencukupi untuk penarikan ini.');
      }
      throw new Error('Gagal memproses penarikan: ' + error.message);
    }

    return result;
  }
}
