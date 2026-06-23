export type TransactionPayload = {
  payment_id: string;
  total_amount: number;
  customer_name: string;
  customer_email: string;
};

export type TransactionResponse = {
  gateway_reference: string;
  payment_url: string;
  redirect_url?: string;
  token?: string;
};

export interface IPaymentGateway {
  createTransaction(payload: TransactionPayload): Promise<TransactionResponse>;
  verifyWebhookSignature(signature: string, body: any): boolean;
}
