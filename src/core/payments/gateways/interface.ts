export type TransactionPayload = {
  order_id: string;
  payment_id: string;
  total_amount: number;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
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
  checkTransactionStatus?(orderId: string): Promise<{ transaction_status: string; status_code: string; fraud_status?: string; gross_amount?: string }>;
}
