import { timingSafeEqual } from 'node:crypto';
import { IPaymentGateway, TransactionPayload, TransactionResponse } from './interface';

export class XenditGateway implements IPaymentGateway {
  async createTransaction(payload: TransactionPayload): Promise<TransactionResponse> {
    // Simulasi HTTP request ke Xendit Invoice API
    console.log(`[Xendit Gateway] Creating invoice for order: ${payload.order_id}`);
    
    // MOCK RESPONSE
    return {
      gateway_reference: payload.order_id,
      payment_url: `https://checkout-staging.xendit.co/web/${payload.order_id}`
    };
  }

  verifyWebhookSignature(signature: string, body: any): boolean {
    // Xendit mengirim callback token statis pada header `x-callback-token`.
    // Bandingkan dengan token yang dikonfigurasi di env secara timing-safe.
    const expected = process.env.XENDIT_CALLBACK_TOKEN || '';
    if (!expected || !signature) return false;

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(signature);
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
