import { createHash, timingSafeEqual } from 'node:crypto';
import { IPaymentGateway, TransactionPayload, TransactionResponse } from './interface';
import { logger } from '../../../lib/logger';

const MIDTRANS_SNAP_URL_SANDBOX = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const MIDTRANS_SNAP_URL_PRODUCTION = 'https://app.midtrans.com/snap/v1/transactions';
const MIDTRANS_API_SANDBOX = 'https://api.sandbox.midtrans.com';
const MIDTRANS_API_PRODUCTION = 'https://api.midtrans.com';

export class MidtransGateway implements IPaymentGateway {
  private serverKey: string;
  private snapUrl: string;
  private apiBase: string;

  constructor() {
    this.serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    this.snapUrl = isProduction ? MIDTRANS_SNAP_URL_PRODUCTION : MIDTRANS_SNAP_URL_SANDBOX;
    this.apiBase = isProduction ? MIDTRANS_API_PRODUCTION : MIDTRANS_API_SANDBOX;

    if (!this.serverKey) {
      logger.warn('[MidtransGateway] MIDTRANS_SERVER_KEY belum diset — transaksi akan gagal. Isi di .env lalu restart server.');
    }
  }

  async createTransaction(payload: TransactionPayload): Promise<TransactionResponse> {
    if (!this.serverKey) {
      throw new Error('MIDTRANS_SERVER_KEY belum dikonfigurasi. Isi di file .env lalu restart server.');
    }

    logger.info({ orderId: payload.order_id, amount: payload.total_amount }, '[Midtrans Gateway] Creating Snap transaction');

    const authString = Buffer.from(this.serverKey + ':').toString('base64');

    const snapBody: Record<string, any> = {
      transaction_details: {
        order_id: payload.order_id,
        gross_amount: payload.total_amount
      },
      customer_details: {
        first_name: payload.customer_name,
        email: payload.customer_email || undefined,
        phone: payload.customer_phone || undefined
      }
    };

    const response = await fetch(this.snapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${authString}`
      },
      body: JSON.stringify(snapBody)
    });

    const data = await response.json() as any;

    if (!response.ok || !data.token) {
      const errMessages = data.error_messages ?? [data.message ?? 'Unknown Midtrans error'];
      logger.error({ response: data }, '[Midtrans Gateway] Snap API error');
      throw new Error(`Midtrans Snap API error: ${errMessages.join(', ')}`);
    }

    const redirectUrl = data.redirect_url
      || `https://app.sandbox.midtrans.com/snap/v4/redirection/${data.token}`;

    return {
      gateway_reference: payload.order_id,
      payment_url: redirectUrl,
      redirect_url: redirectUrl,
      token: data.token
    };
  }

  /**
   * Verifikasi signature notifikasi Midtrans.
   * Algoritma resmi Midtrans:
   *   signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)
   * `signature_key` dikirim di dalam body notifikasi (bukan header). Parameter
   * `signature` (dari header) dipakai sebagai fallback bila ada.
   */
  verifyWebhookSignature(signature: string, body: any): boolean {
    if (!this.serverKey) return false;

    const orderId = body?.order_id;
    const statusCode = body?.status_code;
    const grossAmount = body?.gross_amount;
    const providedSignature = body?.signature_key || signature;

    if (!orderId || !statusCode || grossAmount == null || !providedSignature) {
      return false;
    }

    const expected = createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${this.serverKey}`)
      .digest('hex');

    let expectedBuf: Buffer;
    let providedBuf: Buffer;
    try {
      expectedBuf = Buffer.from(expected, 'hex');
      providedBuf = Buffer.from(String(providedSignature).toLowerCase(), 'hex');
    } catch {
      return false;
    }

    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  async checkTransactionStatus(orderId: string): Promise<{ transaction_status: string; status_code: string; fraud_status?: string; gross_amount?: string }> {
    if (!this.serverKey) {
      throw new Error('MIDTRANS_SERVER_KEY belum dikonfigurasi');
    }

    const authString = Buffer.from(this.serverKey + ':').toString('base64');
    const response = await fetch(`${this.apiBase}/v2/${encodeURIComponent(orderId)}/status`, {
      headers: {
        'Authorization': `Basic ${authString}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json() as any;

    if (!response.ok) {
      throw new Error(`Midtrans status check gagal: ${data.status_message || data.error_messages?.join(', ') || response.status}`);
    }

    return {
      transaction_status: data.transaction_status || '',
      status_code: data.status_code || '',
      fraud_status: data.fraud_status,
      gross_amount: data.gross_amount
    };
  }
}
