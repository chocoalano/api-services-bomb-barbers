import { IPaymentGateway, TransactionPayload, TransactionResponse } from './interface';

export class XenditGateway implements IPaymentGateway {
  async createTransaction(payload: TransactionPayload): Promise<TransactionResponse> {
    // Simulasi HTTP request ke Xendit Invoice API
    console.log(`[Xendit Gateway] Creating invoice for payment: ${payload.payment_id}`);
    
    // MOCK RESPONSE
    return {
      gateway_reference: `XENDIT-${payload.payment_id.split('-')[0].toUpperCase()}`,
      payment_url: `https://checkout-staging.xendit.co/web/${payload.payment_id}`
    };
  }

  verifyWebhookSignature(signature: string, body: any): boolean {
    // Verifikasi via x-callback-token
    return signature === 'mock-xendit-signature' || signature === 'test-signature-xendit';
  }
}
