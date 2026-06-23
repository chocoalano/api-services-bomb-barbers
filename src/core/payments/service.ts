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

/**
 * Generate order_id unik untuk Midtrans.
 * Format: APPT-{8 char pertama appointment_id}-{timestamp}
 * Midtrans menolak order_id yang sudah pernah dipakai, jadi setiap panggilan harus unik.
 */
function generateOrderId(appointmentId: string): string {
  const shortId = appointmentId.replace(/-/g, '').substring(0, 8).toUpperCase();
  return `APPT-${shortId}-${Date.now()}`;
}

export class PaymentService {
  /**
   * Fetch customer details dari appointment untuk dikirim ke payment gateway.
   */
  private static async getCustomerDetails(appointmentId: string) {
    const { data } = await supabase
      .from('appointments')
      .select('customer_id, customers(full_name, email, phone)')
      .eq('id', appointmentId)
      .single();

    if (!data?.customers) {
      return { name: 'Customer', email: 'noreply@bombbarbershop.com', phone: '' };
    }

    const customer = Array.isArray(data.customers) ? data.customers[0] : data.customers;
    return {
      name: customer.full_name || 'Customer',
      email: customer.email || 'noreply@bombbarbershop.com',
      phone: customer.phone || ''
    };
  }

  /**
   * Request Snap token dari payment gateway.
   * Dipanggil baik saat create payment baru maupun saat re-tokenization payment yang sudah ada.
   */
  private static async requestGatewayToken(
    provider: string,
    paymentId: string,
    appointmentId: string,
    totalAmount: number
  ) {
    const orderId = generateOrderId(appointmentId);
    const customerDetails = await this.getCustomerDetails(appointmentId);
    const gateway = GatewayFactory.getGateway(provider);

    const transResponse = await gateway.createTransaction({
      order_id: orderId,
      payment_id: paymentId,
      total_amount: totalAmount,
      customer_name: customerDetails.name,
      customer_email: customerDetails.email,
      customer_phone: customerDetails.phone
    });

    // Simpan order_id terbaru sebagai gateway_reference agar webhook bisa mapping
    await supabase
      .from('payments')
      .update({ gateway_reference: transResponse.gateway_reference })
      .eq('id', paymentId);

    return {
      payment_url: transResponse.payment_url,
      redirect_url: transResponse.redirect_url || transResponse.payment_url,
      token: transResponse.token || null,
      gateway_reference: transResponse.gateway_reference
    };
  }

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

    // ── Coba insert payment baru ──────────────────────────────────────────────
    const { data: newPayment, error: payErr } = await supabase
      .from('payments')
      .insert(paymentRecord)
      .select()
      .single();

    // ── Jika duplikat (payment sudah ada), lakukan re-tokenization ────────────
    if (payErr && payErr.code === '23505') {
      // Ambil payment yang sudah ada
      const { data: existingPayment, error: fetchErr } = await supabase
        .from('payments')
        .select('*')
        .eq('appointment_id', payload.appointment_id)
        .single();

      if (fetchErr || !existingPayment) {
        throw new Error('Gagal mengambil data payment yang sudah ada');
      }

      // Jika sudah paid, tidak perlu re-tokenize
      if (existingPayment.status === 'paid') {
        throw new Error('Pembayaran untuk pesanan ini sudah lunas');
      }

      // Buat Snap token baru untuk payment yang sudah ada
      let gatewayResult = { payment_url: null as string | null, redirect_url: null as string | null, token: null as string | null, gateway_reference: existingPayment.gateway_reference };
      if (payload.provider && payload.method !== 'cash') {
        gatewayResult = await this.requestGatewayToken(
          payload.provider,
          existingPayment.id,
          payload.appointment_id,
          existingPayment.total_amount
        );
      }

      return {
        ...existingPayment,
        gateway_reference: gatewayResult.gateway_reference,
        invoice_number: null,
        invoice_access_token: null,
        payment_url: gatewayResult.payment_url,
        redirect_url: gatewayResult.redirect_url,
        token: gatewayResult.token
      };
    }

    if (payErr) {
      throw new Error('Gagal mencatat pembayaran: ' + payErr.message);
    }

    // ── Request gateway token untuk payment baru ──────────────────────────────
    let paymentUrl = null;
    let redirectUrl = null;
    let token = null;

    if (payload.provider && payload.method !== 'cash') {
      const gatewayResult = await this.requestGatewayToken(
        payload.provider,
        newPayment.id,
        payload.appointment_id,
        totalAmount
      );
      paymentUrl = gatewayResult.payment_url;
      redirectUrl = gatewayResult.redirect_url;
      token = gatewayResult.token;
      newPayment.gateway_reference = gatewayResult.gateway_reference;
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
