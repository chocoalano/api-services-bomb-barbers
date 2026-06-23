import { supabase } from '../../lib/supabase';
import { AuditService } from '../../modules/admin/audit/service';
import { GatewayFactory } from './gateways/factory';
import { createHash } from 'node:crypto';

export class InvoiceService {
  static async generateInvoice(paymentId: string, branchId: string) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const shortBranch = branchId.split('-')[0].toUpperCase(); 
    
    let invoiceNumber = '';
    let publicAccessToken = '';
    let success = false;
    let attempts = 0;

    while (!success && attempts < 3) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      invoiceNumber = `INV-${dateStr}-${shortBranch}-${randomSuffix}`;
      publicAccessToken = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
      const tokenHash = createHash('sha256').update(publicAccessToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      let { error } = await supabase.from('invoices').insert({
        payment_id: paymentId,
        invoice_number: invoiceNumber,
        issued_at: new Date().toISOString(),
        public_access_token_hash: tokenHash,
        public_access_expires_at: expiresAt
      } as any);

      // Kompatibilitas sementara sebelum migration Tahap 1 diterapkan.
      if (
        error &&
        (
          error.message.includes('public_access_token_hash') ||
          error.message.includes('public_access_expires_at')
        )
      ) {
        const legacyInsert = await supabase.from('invoices').insert({
          payment_id: paymentId,
          invoice_number: invoiceNumber,
          issued_at: new Date().toISOString()
        });
        error = legacyInsert.error;
        publicAccessToken = '';
      }

      if (!error) success = true;
      else attempts++;
    }

    if (!success) throw new Error('Gagal membuat invoice number yang unik setelah beberapa percobaan.');
    return {
      invoiceNumber,
      publicAccessToken: publicAccessToken || null
    };
  }
}

type CreatePaymentPayload = {
  appointment_id: string;
  method: string;
  status: string;
  provider?: string;
  product_amount?: number;
  discount_amount?: number;
  tip_amount?: number;
  service_fee?: number;
  delivery_fee?: number;
  gateway_reference?: string;
};

export class PaymentService {
  static async createPayment(payload: CreatePaymentPayload, actorId: string, actorType: 'admin' | 'customer') {
    const { data: apt, error: aptErr } = await supabase
      .from('appointments')
      .select('branch_id, appointment_services(price_amount)')
      .eq('id', payload.appointment_id)
      .single();

    if (aptErr || !apt) throw new Error('Appointment tidak valid atau tidak ditemukan');

    const serviceAmount = apt.appointment_services.reduce((sum: number, s: any) => sum + Number(s.price_amount), 0);
    const productAmount = payload.product_amount || 0;
    const discountAmount = payload.discount_amount || 0;
    const tipAmount = payload.tip_amount || 0;
    const serviceFee = payload.service_fee ?? 5000;
    const deliveryFee = payload.delivery_fee ?? 0;

    const totalAmount = serviceAmount + productAmount + serviceFee + deliveryFee + tipAmount - discountAmount;
    if (totalAmount < 0) throw new Error('Total amount tidak boleh negatif');

    const paymentRecord: any = {
      appointment_id: payload.appointment_id,
      branch_id: apt.branch_id,
      service_amount: serviceAmount,
      product_amount: productAmount,
      service_fee: serviceFee,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      tip_amount: tipAmount,
      total_amount: totalAmount,
      method: payload.method,
      status: payload.status,
      gateway_reference: payload.gateway_reference || null
    };

    let invoiceNumber = null;

    if (payload.status === 'paid') paymentRecord.paid_at = new Date().toISOString();

    const { data: newPayment, error: payErr } = await supabase
      .from('payments')
      .insert(paymentRecord)
      .select()
      .single();

    if (payErr) {
      if (payErr.code === '23505') throw new Error('Pembayaran untuk pesanan ini sudah pernah dibuat sebelumnya (Double Pay Protection)');
      throw new Error('Gagal mencatat pembayaran: ' + payErr.message);
    }

    let paymentUrl = null;
    let redirectUrl = null;
    let token = null;

    if (payload.provider && payload.method !== 'cash') {
      const gateway = GatewayFactory.getGateway(payload.provider);
      const transResponse = await gateway.createTransaction({
        payment_id: newPayment.id,
        total_amount: totalAmount,
        customer_name: 'Customer', 
        customer_email: 'customer@example.com'
      });

      paymentUrl = transResponse.payment_url;
      redirectUrl = transResponse.redirect_url || transResponse.payment_url;
      token = transResponse.token || null;
      await supabase.from('payments').update({ gateway_reference: transResponse.gateway_reference }).eq('id', newPayment.id);
      newPayment.gateway_reference = transResponse.gateway_reference;
    }

    if (payload.status === 'paid') {
      const invoice = await InvoiceService.generateInvoice(newPayment.id, apt.branch_id);
      invoiceNumber = invoice.invoiceNumber;
      (newPayment as any).invoice_access_token = invoice.publicAccessToken;
    }

    await AuditService.logAction(
      actorType,
      actorId,
      'CREATE_PAYMENT',
      'payments',
      newPayment.id,
      null,
      newPayment,
      newPayment.branch_id ?? null
    );

    return {
      ...newPayment,
      invoice_number: invoiceNumber,
      invoice_access_token: (newPayment as any).invoice_access_token || null,
      payment_url: paymentUrl,
      redirect_url: redirectUrl,
      token
    };
  }

  static async updatePaymentStatus(id: string, newStatus: string, actorId: string, actorType: 'admin' | 'customer' | 'system') {
    const { data: oldPayment, error: fetchErr } = await supabase.from('payments').select('*').eq('id', id).single();
    if (fetchErr || !oldPayment) throw new Error('Payment tidak ditemukan');
    if (oldPayment.status === 'paid' && newStatus === 'paid') throw new Error('Payment sudah lunas');

    const updates: any = { status: newStatus };
    let invoiceNumber = null;

    if (newStatus === 'paid' && !oldPayment.paid_at) updates.paid_at = new Date().toISOString();

    const { data: newPayment, error: updErr } = await supabase
      .from('payments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updErr) throw new Error('Gagal update pembayaran: ' + updErr.message);

    if (newStatus === 'paid' && oldPayment.status !== 'paid') {
      const invoice = await InvoiceService.generateInvoice(newPayment.id, newPayment.branch_id);
      invoiceNumber = invoice.invoiceNumber;
      (newPayment as any).invoice_access_token = invoice.publicAccessToken;
    }

    await AuditService.logAction(
      actorType,
      actorId,
      'UPDATE_PAYMENT_STATUS',
      'payments',
      id,
      oldPayment,
      newPayment,
      newPayment.branch_id ?? null
    );

    return {
      ...newPayment,
      invoice_number: invoiceNumber,
      invoice_access_token: (newPayment as any).invoice_access_token || null
    };
  }
}
