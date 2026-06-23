import { IPaymentGateway, TransactionPayload, TransactionResponse } from './interface';

export class MidtransGateway implements IPaymentGateway {
  async createTransaction(payload: TransactionPayload): Promise<TransactionResponse> {
    // Simulasi HTTP request ke Midtrans Snap API
    console.log(`[Midtrans Gateway] Creating transaction for payment: ${payload.payment_id}`);

    const paymentUrl = `https://app.sandbox.midtrans.com/snap/v2/vtweb/${payload.payment_id}`;
    
    // MOCK RESPONSE untuk keutuhan arsitektur (Tanpa real API key)
    return {
      gateway_reference: `MIDTRANS-${payload.payment_id.split('-')[0].toUpperCase()}`,
      payment_url: paymentUrl,
      redirect_url: paymentUrl,
      token: `SNAP-${payload.payment_id}`
    };
  }

  verifyWebhookSignature(signature: string, body: any): boolean {
    // Simulasi verifikasi HMAC SHA512
    // Produksi nyata: HMAC_SHA512(ServerKey + body.order_id + body.status_code + body.gross_amount) == signature
    return signature === 'mock-midtrans-signature' || signature === 'test-signature-midtrans';
  }
}
