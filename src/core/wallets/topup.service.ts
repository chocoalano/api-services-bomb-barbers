import { randomUUID } from 'crypto';
import { db } from '../../lib/db';
import { customers, walletTopups } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { asRpcResult, settleWalletTopup } from '../../db/procedures';
import { GatewayFactory } from '../payments/gateways/factory';

const MIN_TOPUP = Number(process.env.WALLET_TOPUP_MIN || 10000);
const MAX_TOPUP = Number(process.env.WALLET_TOPUP_MAX || 10000000);

/** order_id unik untuk Midtrans (prefix TOPUP- agar webhook bisa membedakan). */
function generateTopupOrderId(topupId: string): string {
  const shortId = topupId.replace(/-/g, '').substring(0, 8).toUpperCase();
  return `TOPUP-${shortId}-${Date.now()}`;
}

const withStatus = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

export class TopupService {
  private static async getCustomerDetails(customerId: string) {
    const [data] = await db
      .select({ full_name: customers.fullName, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    return {
      name: data?.full_name || 'Customer',
      email: data?.email || 'noreply@bombbarbershop.com',
      phone: data?.phone || ''
    };
  }

  /**
   * Inisiasi top-up: buat record pending, minta Snap token ke gateway, kembalikan
   * URL/token pembayaran. Saldo TIDAK dikreditkan sampai pembayaran terkonfirmasi.
   */
  static async createTopup(
    customerId: string,
    payload: { amount: number; provider?: string; method?: string }
  ) {
    const amount = Math.round(Number(payload.amount));
    if (!Number.isFinite(amount) || amount < MIN_TOPUP) {
      throw withStatus(`Minimal top-up adalah Rp ${MIN_TOPUP.toLocaleString('id-ID')}`, 400);
    }
    if (amount > MAX_TOPUP) {
      throw withStatus(`Maksimal top-up adalah Rp ${MAX_TOPUP.toLocaleString('id-ID')}`, 400);
    }

    const provider = payload.provider || 'midtrans';

    const topupId = randomUUID();
    await db.insert(walletTopups).values({
      id: topupId,
      customerId,
      amount: String(amount),
      provider,
      method: payload.method || null,
      status: 'pending'
    });
    const [topup] = await db
      .select({ id: walletTopups.id })
      .from(walletTopups)
      .where(eq(walletTopups.id, topupId))
      .limit(1);

    if (!topup) {
      throw new Error('Gagal membuat top-up: unknown');
    }

    const orderId = generateTopupOrderId(topup.id);
    const customer = await this.getCustomerDetails(customerId);
    const gateway = GatewayFactory.getGateway(provider);

    const trans = await gateway.createTransaction({
      order_id: orderId,
      payment_id: topup.id,
      total_amount: amount,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone
    });

    await db
      .update(walletTopups)
      .set({ gatewayReference: trans.gateway_reference })
      .where(eq(walletTopups.id, topup.id));

    return {
      topup_id: topup.id,
      amount,
      status: 'pending',
      gateway_reference: trans.gateway_reference,
      payment_url: trans.payment_url,
      redirect_url: trans.redirect_url || trans.payment_url,
      token: trans.token || null
    };
  }

  /**
   * Dipanggil customer setelah WebView Midtrans sukses. Backend verifikasi status
   * ke Midtrans, cocokkan nominal, lalu settle (kredit saldo) secara atomik.
   */
  static async confirmTopup(customerId: string, topupId: string) {
    const [topup] = await db
      .select({
        id: walletTopups.id,
        customer_id: walletTopups.customerId,
        amount: walletTopups.amount,
        status: walletTopups.status,
        gateway_reference: walletTopups.gatewayReference,
        provider: walletTopups.provider
      })
      .from(walletTopups)
      .where(eq(walletTopups.id, topupId))
      .limit(1);

    if (!topup) throw withStatus('Top-up tidak ditemukan', 404);
    if (topup.customer_id !== customerId) throw withStatus('Top-up bukan milik Anda', 403);
    if (topup.status === 'paid') return { status: 'paid' };
    if (!topup.gateway_reference) throw withStatus('Transaksi Midtrans belum dibuat', 400);

    const gateway = GatewayFactory.getGateway(topup.provider || 'midtrans');
    if (!gateway.checkTransactionStatus) {
      throw new Error('Gateway tidak mendukung verifikasi status transaksi');
    }

    const statusData = await gateway.checkTransactionStatus(topup.gateway_reference);
    const paidStatuses = ['settlement', 'capture'];
    if (!paidStatuses.includes(statusData.transaction_status)) {
      return { status: topup.status, midtrans_status: statusData.transaction_status };
    }

    if (statusData.gross_amount != null) {
      const gross = Math.round(Number(statusData.gross_amount));
      if (!Number.isFinite(gross) || gross !== Math.round(Number(topup.amount))) {
        throw withStatus('Nominal pembayaran tidak sesuai dengan top-up', 400);
      }
    }

    const { data: result, error: settleErr } = await asRpcResult(() =>
      settleWalletTopup({ topupId: topup.id })
    );
    if (settleErr) {
      // Sudah diproses lebih dulu (mis. oleh webhook) → tetap dianggap sukses.
      if (settleErr.code === 'P0002') return { status: 'paid' };
      throw new Error(settleErr.message);
    }

    return { status: 'paid', new_balance: (result as any)?.new_balance ?? null };
  }

  /** Dipakai webhook Midtrans: settle top-up berdasarkan gateway_reference. */
  static async settleByGatewayReference(
    gatewayReference: string,
    grossAmount?: number | string | null
  ) {
    const [topup] = await db
      .select({
        id: walletTopups.id,
        amount: walletTopups.amount,
        status: walletTopups.status,
        customer_id: walletTopups.customerId
      })
      .from(walletTopups)
      .where(eq(walletTopups.gatewayReference, gatewayReference))
      .limit(1);

    if (!topup) return { found: false as const };
    if (topup.status === 'paid') return { found: true as const, alreadyPaid: true };

    if (grossAmount != null) {
      const gross = Math.round(Number(grossAmount));
      if (!Number.isFinite(gross) || gross !== Math.round(Number(topup.amount))) {
        throw new Error(`gross_amount (${grossAmount}) tidak sesuai top-up (${topup.amount})`);
      }
    }

    const { data: result, error } = await asRpcResult(() => settleWalletTopup({ topupId: topup.id }));
    if (error && error.code !== 'P0002') throw new Error(error.message);

    return {
      found: true as const,
      settled: true,
      customer_id: topup.customer_id,
      amount: Number(topup.amount),
      new_balance: (result as any)?.new_balance ?? null
    };
  }
}
