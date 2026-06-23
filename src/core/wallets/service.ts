import { supabase } from '../../lib/supabase';

export class WalletService {
  /**
   * Mengambil saldo wallet barber beserta riwayat transaksinya.
   */
  static async getWalletDetails(staffUserId: string) {
    // Cari barber_id dari staff_user_id
    const { data: barber, error: barberErr } = await supabase
      .from('barbers')
      .select('id')
      .eq('staff_user_id', staffUserId)
      .single();

    if (!barber || barberErr) {
      throw new Error('Data barber tidak ditemukan');
    }

    const barberId = barber.id;

    // Pastikan wallet ada, jika tidak ada karena race condition atau data lama, buatkan
    let { data: wallet, error: walletErr } = await supabase
      .from('barber_wallets')
      .select('*')
      .eq('barber_id', barberId)
      .single();

    if (!wallet) {
      const { data: newWallet, error: createErr } = await supabase
        .from('barber_wallets')
        .insert({ barber_id: barberId, balance: 0 })
        .select()
        .single();
        
      if (createErr) throw new Error('Gagal membuat wallet: ' + createErr.message);
      wallet = newWallet;
    }

    const { data: transactions, error: txErr } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (txErr) throw new Error('Gagal mengambil riwayat transaksi: ' + txErr.message);

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

    // Cari barber_id dari staff_user_id
    const { data: barber, error: barberErr } = await supabase
      .from('barbers')
      .select('id')
      .eq('staff_user_id', staffUserId)
      .single();

    if (!barber || barberErr) {
      throw new Error('Data barber tidak ditemukan');
    }

    const { data: result, error } = await supabase.rpc('request_withdrawal', {
      p_barber_id: barber.id,
      p_amount: payload.amount,
      p_bank_name: payload.bank_name,
      p_account_number: payload.account_number,
      p_account_name: payload.account_name
    });

    if (error) {
      if (error.message.includes('Insufficient balance')) {
        throw new Error('Saldo tidak mencukupi untuk penarikan ini.');
      }
      throw new Error('Gagal memproses penarikan: ' + error.message);
    }

    return result;
  }
}
