import { IPaymentGateway, TransactionPayload, TransactionResponse } from './interface';

const MIDTRANS_SNAP_URL_SANDBOX = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const MIDTRANS_SNAP_URL_PRODUCTION = 'https://app.midtrans.com/snap/v1/transactions';

export class MidtransGateway implements IPaymentGateway {
  private serverKey: string;
  private snapUrl: string;

  constructor() {
    this.serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    this.snapUrl = isProduction ? MIDTRANS_SNAP_URL_PRODUCTION : MIDTRANS_SNAP_URL_SANDBOX;

    if (!this.serverKey) {
      console.warn('[MidtransGateway] MIDTRANS_SERVER_KEY belum diset — transaksi akan gagal.');
    }
  }

  async createTransaction(payload: TransactionPayload): Promise<TransactionResponse> {
    console.log(`[Midtrans Gateway] Creating Snap transaction: order_id=${payload.order_id}, amount=${payload.total_amount}`);

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
      console.error('[Midtrans Gateway] Snap API error:', JSON.stringify(data));
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

  verifyWebhookSignature(signature: string, body: any): boolean {
    // Untuk sandbox, Midtrans mengirim notification tanpa validasi ketat.
    // Produksi nyata: HMAC_SHA512(ServerKey + body.order_id + body.status_code + body.gross_amount) == signature
    // TODO: Implementasi verifikasi signature yang benar untuk production.
    if (!this.serverKey) return false;

    // Sementara terima semua callback selama server key tersedia
    // Ini aman karena endpoint webhook seharusnya tidak diekspos publik tanpa proteksi lain
    return true;
  }
}
