import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { PaymentService } from './service';
import { GatewayFactory } from './gateways/factory';
import { supabase } from '../../lib/supabase';
import { createHash, timingSafeEqual } from 'node:crypto';

const unwrapRelation = (value: any) => Array.isArray(value) ? value[0] : value;

const formatInvoiceReceipt = (invoice: any) => {
  const payment = unwrapRelation(invoice.payments);
  const appointment = unwrapRelation(payment?.appointments);
  const branch = unwrapRelation(appointment?.branches);

  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    issued_at: invoice.issued_at,
    pdf_url: invoice.pdf_url ?? null,
    payment: payment ? {
      id: payment.id,
      total_amount: payment.total_amount,
      service_amount: payment.service_amount,
      product_amount: payment.product_amount,
      discount_amount: payment.discount_amount,
      tip_amount: payment.tip_amount,
      method: payment.method,
      status: payment.status,
      paid_at: payment.paid_at,
      appointment: appointment ? {
        id: appointment.id,
        status: appointment.status,
        branch: branch ? {
          id: branch.id,
          name: branch.name
        } : null
      } : null
    } : null
  };
};

export class AdminPaymentController {
  static async createPayment({ params, body, staffId, set }: any) {
    try {
      const payload = { appointment_id: params.id, ...body };
      const res = await PaymentService.createPayment(payload, staffId, 'admin');
      set.status = 201;
      return createSuccessResponse('Pembayaran berhasil dicatat', res);
    } catch (err: any) {
      if (err.message.includes('Double Pay')) set.status = 409;
      else set.status = 400;
      return createErrorResponse(err.message);
    }
  }

  static async getPaymentDetail({ params, set }: any) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*, appointments(*), invoices(invoice_number, pdf_url)')
        .eq('id', params.id)
        .single();
      if (error || !data) { set.status = 404; return createErrorResponse('Pembayaran tidak ditemukan'); }
      return createSuccessResponse('Detail pembayaran', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getBranchPayments({ params, set }: any) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*, invoices(invoice_number)')
        .eq('branch_id', params.branchId)
        .order('created_at', { ascending: false });
      if (error) { set.status = 400; return createErrorResponse(error.message); }
      return createSuccessResponse('Transaksi Cabang', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }
}

export class CustomerPaymentController {
  static async getMyPaymentDetail({ params, customerId, set }: any) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*, appointments!inner(customer_id), invoices(invoice_number, pdf_url)')
        .eq('id', params.id)
        .eq('appointments.customer_id', customerId)
        .single();

      if (error || !data) { set.status = 404; return createErrorResponse('Pembayaran tidak valid atau bukan milik Anda'); }
      return createSuccessResponse('Detail Pembayaran', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getPaymentByAppointment({ params, customerId, set }: any) {
    try {
      const { data: apt } = await supabase
        .from('appointments')
        .select('id')
        .eq('id', params.id)
        .eq('customer_id', customerId)
        .maybeSingle();

      if (!apt) { set.status = 403; return createErrorResponse('Appointment tidak ditemukan atau bukan milik Anda'); }

      const { data, error } = await supabase
        .from('payments')
        .select('id, status, total_amount, service_amount, tip_amount, discount_amount, method, paid_at, invoices(invoice_number, pdf_url)')
        .eq('appointment_id', params.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) { set.status = 404; return createErrorResponse('Belum ada pembayaran untuk appointment ini'); }
      return createSuccessResponse('Status pembayaran appointment', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async createPayment({ params, body, customerId, set }: any) {
    try {
      // Ensure appointment belongs to customer
      const { data: apt, error: aptErr } = await supabase.from('appointments').select('customer_id').eq('id', params.id).single();
      if (aptErr || !apt || apt.customer_id !== customerId) throw new Error('Appointment tidak valid atau bukan milik Anda');

      const payload = { appointment_id: params.id, ...body, status: body.status || 'pending' };
      const res = await PaymentService.createPayment(payload, customerId, 'customer');
      set.status = 201;
      return createSuccessResponse('Inisiasi pembayaran berhasil', res);
    } catch (err: any) {
      if (err.message.includes('Double Pay')) set.status = 409;
      else set.status = 400;
      return createErrorResponse(err.message);
    }
  }
}

export class InvoiceController {
  static async getCustomerInvoiceReceipt({ params, customerId, set }: any) {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          issued_at,
          pdf_url,
          payments!inner (
            id,
            total_amount,
            service_amount,
            product_amount,
            discount_amount,
            tip_amount,
            method,
            status,
            paid_at,
            appointments!inner (
              id,
              customer_id,
              status,
              branches (
                id,
                name
              )
            )
          )
        `)
        .eq('invoice_number', params.invoiceNumber)
        .eq('payments.appointments.customer_id', customerId)
        .maybeSingle();

      if (error || !data) { set.status = 404; return createErrorResponse('Invoice tidak ditemukan'); }
      return createSuccessResponse('Nota Pembayaran', formatInvoiceReceipt(data));
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getPublicInvoiceReceipt({ params, query, set }: any) {
    try {
      if (!query.token) {
        set.status = 401;
        return createErrorResponse('Token akses invoice wajib dikirim');
      }

      const { data, error } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          issued_at,
          pdf_url,
          public_access_token_hash,
          public_access_expires_at,
          payments!inner (
            id,
            total_amount,
            service_amount,
            product_amount,
            discount_amount,
            tip_amount,
            method,
            status,
            paid_at,
            appointments!inner (
              id,
              status,
              branches (
                id,
                name
              )
            )
          )
        `)
        .eq('invoice_number', params.invoiceNumber)
        .maybeSingle();

      if (error || !data || !data.public_access_token_hash) {
        set.status = 404;
        return createErrorResponse('Invoice publik tidak tersedia');
      }
      if (
        !data.public_access_expires_at ||
        new Date(data.public_access_expires_at).getTime() <= Date.now()
      ) {
        set.status = 410;
        return createErrorResponse('Token akses invoice sudah kedaluwarsa');
      }

      const providedHash = createHash('sha256').update(query.token).digest();
      const expectedHash = Buffer.from(data.public_access_token_hash, 'hex');
      if (
        providedHash.length !== expectedHash.length ||
        !timingSafeEqual(providedHash, expectedHash)
      ) {
        set.status = 401;
        return createErrorResponse('Token akses invoice tidak valid');
      }

      return createSuccessResponse('Nota Pembayaran', formatInvoiceReceipt(data));
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }
}

export class WebhookController {
  static async handlePaymentWebhook({ params, body, request, set }: any) {
    try {
      const provider = params?.provider || body.provider || 'midtrans';
      const signature = request.headers.get('x-callback-token') || request.headers.get('signature') || '';

      const gateway = GatewayFactory.getGateway(provider);

      if (!gateway.verifyWebhookSignature(signature, body)) {
        set.status = 401;
        return createErrorResponse('Invalid signature');
      }

      // order_id dari Midtrans callback = gateway_reference yang kita simpan di DB
      const orderId = body.order_id || body.external_id;
      if (!orderId) throw new Error('Order ID tidak ditemukan di payload webhook');

      if (body.status_code !== '200' && body.status !== 'PAID') {
        return createSuccessResponse('Webhook diterima tapi tidak memicu lunas', null);
      }

      // Cari payment berdasarkan gateway_reference (bukan langsung pakai order_id sebagai UUID)
      const { data: payment } = await supabase
        .from('payments')
        .select('id, status')
        .eq('gateway_reference', orderId)
        .maybeSingle();

      if (!payment) {
        set.status = 404;
        return createErrorResponse('Webhook Error: Payment tidak ditemukan untuk order_id: ' + orderId);
      }
      if (payment.status === 'paid') return createSuccessResponse('Payment sudah lunas sebelumnya', null);

      await PaymentService.updatePaymentStatus(
        payment.id, 
        'paid', 
        '00000000-0000-0000-0000-000000000000', 
        'system'
      );

      return createSuccessResponse('Webhook berhasil diproses', null);
    } catch (err: any) {
      if (err.message.includes('Payment sudah lunas')) {
        return createSuccessResponse('Payment sudah lunas sebelumnya', null);
      }

      set.status = 500;
      return createErrorResponse('Webhook Error: ' + err.message);
    }
  }
}
