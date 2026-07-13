import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { PaymentService } from './service';
import { GatewayFactory } from './gateways/factory';
import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { payments, appointments, invoices, branches } from '../../db/schema';
import { and, eq, desc, type SQL } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { emitNewOrder, emitAppointmentStatusChanged } from '../../lib/socket';
import { TopupService } from '../wallets/topup.service';
import { logger } from '../../lib/logger';

const unwrapRelation = (value: any) => Array.isArray(value) ? value[0] : value;

// Muat invoice + payment + appointment + branch (pengganti embed bertingkat).
async function loadInvoiceForReceipt(cond: SQL) {
  const [row] = await db
    .select({
      inv: invoices,
      payId: payments.id,
      payTotal: payments.totalAmount,
      payService: payments.serviceAmount,
      payProduct: payments.productAmount,
      payDiscount: payments.discountAmount,
      payTip: payments.tipAmount,
      payMethod: payments.method,
      payStatus: payments.status,
      payPaidAt: payments.paidAt,
      aptId: appointments.id,
      aptCustomerId: appointments.customerId,
      aptStatus: appointments.status,
      branchId: branches.id,
      branchName: branches.name
    })
    .from(invoices)
    .innerJoin(payments, eq(invoices.paymentId, payments.id))
    .innerJoin(appointments, eq(payments.appointmentId, appointments.id))
    .leftJoin(branches, eq(appointments.branchId, branches.id))
    .where(cond)
    .limit(1);
  if (!row) return null;
  return {
    ...snakeKeys(row.inv),
    payments: {
      id: row.payId,
      total_amount: row.payTotal,
      service_amount: row.payService,
      product_amount: row.payProduct,
      discount_amount: row.payDiscount,
      tip_amount: row.payTip,
      method: row.payMethod,
      status: row.payStatus,
      paid_at: row.payPaidAt,
      appointments: {
        id: row.aptId,
        customer_id: row.aptCustomerId,
        status: row.aptStatus,
        branches: row.branchId ? { id: row.branchId, name: row.branchName } : null
      }
    }
  } as any;
}

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
      else set.status = err.status || 400;
      return createErrorResponse(err.message, err.errors ?? null, err.code ?? null, err.data ?? null);
    }
  }

  static async getPaymentDetail({ params, set }: any) {
    try {
      const [row] = await db
        .select({ pay: payments, apt: appointments, invNumber: invoices.invoiceNumber, invPdf: invoices.pdfUrl })
        .from(payments)
        .leftJoin(appointments, eq(payments.appointmentId, appointments.id))
        .leftJoin(invoices, eq(invoices.paymentId, payments.id))
        .where(eq(payments.id, params.id))
        .limit(1);
      if (!row) { set.status = 404; return createErrorResponse('Pembayaran tidak ditemukan'); }
      const data = {
        ...snakeKeys(row.pay),
        appointments: row.apt ? snakeKeys(row.apt) : null,
        invoices: row.invNumber != null ? { invoice_number: row.invNumber, pdf_url: row.invPdf } : null
      };
      return createSuccessResponse('Detail pembayaran', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getBranchPayments({ params, set }: any) {
    try {
      const rows = await db
        .select({ pay: payments, invNumber: invoices.invoiceNumber })
        .from(payments)
        .leftJoin(invoices, eq(invoices.paymentId, payments.id))
        .where(eq(payments.branchId, params.branchId))
        .orderBy(desc(payments.createdAt));
      const data = rows.map((r) => ({
        ...snakeKeys(r.pay),
        invoices: r.invNumber != null ? { invoice_number: r.invNumber } : null
      }));
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
      const [row] = await db
        .select({ pay: payments, invNumber: invoices.invoiceNumber, invPdf: invoices.pdfUrl })
        .from(payments)
        .innerJoin(appointments, eq(payments.appointmentId, appointments.id))
        .leftJoin(invoices, eq(invoices.paymentId, payments.id))
        .where(and(eq(payments.id, params.id), eq(appointments.customerId, customerId)))
        .limit(1);

      if (!row) { set.status = 404; return createErrorResponse('Pembayaran tidak valid atau bukan milik Anda'); }
      const data = {
        ...snakeKeys(row.pay),
        invoices: row.invNumber != null ? { invoice_number: row.invNumber, pdf_url: row.invPdf } : null
      };
      return createSuccessResponse('Detail Pembayaran', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getPaymentByAppointment({ params, customerId, set }: any) {
    try {
      const [apt] = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.id, params.id), eq(appointments.customerId, customerId)))
        .limit(1);

      if (!apt) { set.status = 403; return createErrorResponse('Appointment tidak ditemukan atau bukan milik Anda'); }

      const [row] = await db
        .select({
          id: payments.id,
          status: payments.status,
          total_amount: payments.totalAmount,
          service_amount: payments.serviceAmount,
          tip_amount: payments.tipAmount,
          discount_amount: payments.discountAmount,
          method: payments.method,
          paid_at: payments.paidAt,
          invNumber: invoices.invoiceNumber,
          invPdf: invoices.pdfUrl
        })
        .from(payments)
        .leftJoin(invoices, eq(invoices.paymentId, payments.id))
        .where(eq(payments.appointmentId, params.id))
        .limit(1);

      if (!row) { set.status = 404; return createErrorResponse('Belum ada pembayaran untuk appointment ini'); }
      const { invNumber, invPdf, ...rest } = row;
      const data = { ...rest, invoices: invNumber != null ? { invoice_number: invNumber, pdf_url: invPdf } : null };
      return createSuccessResponse('Status pembayaran appointment', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async createPayment({ params, body, customerId, set }: any) {
    try {
      // Ensure appointment belongs to customer
      const [apt] = await db.select({ customer_id: appointments.customerId }).from(appointments).where(eq(appointments.id, params.id)).limit(1);
      if (!apt || apt.customer_id !== customerId) throw new Error('Appointment tidak valid atau bukan milik Anda');

      const payload = { appointment_id: params.id, ...body, status: body.status || 'pending' };
      const res = await PaymentService.createPayment(payload, customerId, 'customer');
      set.status = 201;
      return createSuccessResponse('Inisiasi pembayaran berhasil', res);
    } catch (err: any) {
      if (err.message.includes('Double Pay')) set.status = 409;
      else set.status = err.status || 400;
      return createErrorResponse(err.message, err.errors ?? null, err.code ?? null, err.data ?? null);
    }
  }

  /**
   * Dipanggil customer setelah WebView Midtrans Snap mendeteksi pembayaran berhasil.
   * Backend memverifikasi status ke Midtrans, lalu menandai payment dan appointment.
   */
  static async confirmPayment({ params, customerId, set }: any) {
    try {
      // 1. Pastikan appointment milik customer
      const [apt] = await db
        .select({
          id: appointments.id,
          customer_id: appointments.customerId,
          status: appointments.status,
          barber_id: appointments.barberId,
          branch_id: appointments.branchId
        })
        .from(appointments)
        .where(eq(appointments.id, params.id))
        .limit(1);

      if (!apt || apt.customer_id !== customerId) {
        set.status = 403;
        return createErrorResponse('Appointment tidak valid atau bukan milik Anda');
      }

      // 2. Cari payment pending untuk appointment ini
      const [payment] = await db
        .select({ id: payments.id, status: payments.status, gateway_reference: payments.gatewayReference, total_amount: payments.totalAmount })
        .from(payments)
        .where(eq(payments.appointmentId, params.id))
        .limit(1);

      if (!payment) {
        set.status = 404;
        return createErrorResponse('Payment tidak ditemukan untuk appointment ini');
      }

      // Sudah lunas — kembalikan sukses langsung
      if (payment.status === 'paid') {
        return createSuccessResponse('Pembayaran sudah terkonfirmasi', { status: 'paid' });
      }

      if (!payment.gateway_reference) {
        set.status = 400;
        return createErrorResponse('Transaksi Midtrans belum dibuat. Coba lakukan pembayaran dari awal.');
      }

      // 3. Verifikasi status ke Midtrans
      const gateway = GatewayFactory.getGateway('midtrans');
      if (!gateway.checkTransactionStatus) {
        set.status = 500;
        return createErrorResponse('Gateway tidak mendukung verifikasi status transaksi');
      }

      const statusData = await gateway.checkTransactionStatus(payment.gateway_reference);
      const paidStatuses = ['settlement', 'capture'];

      if (!paidStatuses.includes(statusData.transaction_status)) {
        return createSuccessResponse('Pembayaran belum terkonfirmasi di Midtrans', {
          status: payment.status,
          midtrans_status: statusData.transaction_status
        });
      }

      // Verifikasi nominal yang benar-benar dibayar sama dengan invoice. (M1)
      if (statusData.gross_amount != null) {
        const gross = Math.round(Number(statusData.gross_amount));
        const expected = Math.round(Number(payment.total_amount));
        if (!Number.isFinite(gross) || gross !== expected) {
          set.status = 400;
          return createErrorResponse(
            `Nominal pembayaran (${statusData.gross_amount}) tidak sesuai tagihan (${expected})`
          );
        }
      }

      // 4. Tandai payment sebagai paid
      await PaymentService.updatePaymentStatus(payment.id, 'paid', customerId, 'customer');

      // Beritahu customer (room customer:<id>) agar halaman "Pesanan" refresh dan
      // membaca status pembayaran terbaru. Tanpa ini, jika konfirmasi terjadi
      // setelah halaman termuat, pill pembayaran akan macet di "Belum bayar".
      emitAppointmentStatusChanged({
        appointment_id: apt.id,
        status: apt.status,
        raw_status: apt.status,
        barber_id: apt.barber_id ?? null,
        customer_id: apt.customer_id ?? null,
        branch_id: apt.branch_id ?? null,
        timestamp: new Date().toISOString()
      });

      // Notifikasi barber bahwa pembayaran telah dikonfirmasi — barber tetap harus
      // menerima order secara eksplisit melalui endpoint verify-and-accept.
      if (apt.barber_id) {
        emitNewOrder(apt.barber_id, {
          appointment_id: apt.id,
          timestamp: new Date().toISOString()
        });
      }

      return createSuccessResponse('Pembayaran berhasil dikonfirmasi', { status: 'paid' });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse('Gagal mengkonfirmasi pembayaran: ' + err.message);
    }
  }
}

export class InvoiceController {
  static async getCustomerInvoiceReceipt({ params, customerId, set }: any) {
    try {
      const data = await loadInvoiceForReceipt(
        and(eq(invoices.invoiceNumber, params.invoiceNumber), eq(appointments.customerId, customerId))!
      );

      if (!data) { set.status = 404; return createErrorResponse('Invoice tidak ditemukan'); }
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

      const data = await loadInvoiceForReceipt(eq(invoices.invoiceNumber, params.invoiceNumber));

      if (!data || !data.public_access_token_hash) {
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

type GatewayPaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

const MIDTRANS_STATUS_TO_PAYMENT_STATUS: Record<string, GatewayPaymentStatus> = {
  pending: 'pending',
  settlement: 'paid',
  capture: 'paid',
  deny: 'failed',
  cancel: 'failed',
  failure: 'failed',
  expire: 'expired'
};

const XENDIT_STATUS_TO_PAYMENT_STATUS: Record<string, GatewayPaymentStatus> = {
  PENDING: 'pending',
  PAID: 'paid',
  SETTLED: 'paid',
  EXPIRED: 'expired',
  FAILED: 'failed'
};

const resolveGatewayPaymentStatus = (
  provider: string,
  body: any
): { paymentStatus: GatewayPaymentStatus | null; providerStatus: string | null } => {
  const normalizedProvider = String(provider || 'midtrans').toLowerCase();

  if (normalizedProvider === 'midtrans') {
    const transactionStatus = String(body?.transaction_status || '').toLowerCase();
    const statusCode = String(body?.status_code || '');
    const mapped = MIDTRANS_STATUS_TO_PAYMENT_STATUS[transactionStatus];

    if (mapped) {
      return {
        paymentStatus: mapped,
        providerStatus: transactionStatus
      };
    }

    // Backward-compatible fallback untuk payload mock lama yang hanya mengirim
    // status_code. Payload Midtrans nyata tetap dipetakan dari transaction_status.
    if (statusCode === '200') return { paymentStatus: 'paid', providerStatus: statusCode };
    if (statusCode === '201') return { paymentStatus: 'pending', providerStatus: statusCode };

    return { paymentStatus: null, providerStatus: transactionStatus || statusCode || null };
  }

  if (normalizedProvider === 'xendit') {
    const gatewayStatus = String(body?.status || '').toUpperCase();
    return {
      paymentStatus: XENDIT_STATUS_TO_PAYMENT_STATUS[gatewayStatus] ?? null,
      providerStatus: gatewayStatus || null
    };
  }

  return { paymentStatus: null, providerStatus: null };
};

export class WebhookController {
  static async handlePaymentWebhook({ params, body, request, set }: any) {
    try {
      const provider = String(params?.provider || body.provider || 'midtrans').toLowerCase();
      const signature = request.headers.get('x-callback-token') || request.headers.get('signature') || '';

      const gateway = GatewayFactory.getGateway(provider);

      if (!gateway.verifyWebhookSignature(signature, body)) {
        set.status = 401;
        return createErrorResponse('Invalid signature');
      }

      // order_id dari Midtrans callback = gateway_reference yang kita simpan di DB
      const orderId = body.order_id || body.external_id;
      if (!orderId) throw new Error('Order ID tidak ditemukan di payload webhook');

      const gatewayStatus = resolveGatewayPaymentStatus(provider, body);
      if (!gatewayStatus.paymentStatus) {
        return createSuccessResponse('Webhook diterima tanpa perubahan status payment', {
          provider,
          provider_status: gatewayStatus.providerStatus
        });
      }

      // Top-up saldo: order_id berprefiks TOPUP-. Settle saldo & selesai.
      if (String(orderId).startsWith('TOPUP-')) {
        if (gatewayStatus.paymentStatus !== 'paid') {
          return createSuccessResponse('Webhook top-up diterima tanpa settlement', {
            provider,
            provider_status: gatewayStatus.providerStatus,
            payment_status: gatewayStatus.paymentStatus
          });
        }

        const res = await TopupService.settleByGatewayReference(orderId, body.gross_amount);
        if (!res.found) {
          set.status = 404;
          return createErrorResponse('Webhook Error: Top-up tidak ditemukan untuk order_id: ' + orderId);
        }
        return createSuccessResponse('Webhook top-up berhasil diproses', null);
      }

      // Cari payment berdasarkan gateway_reference (bukan langsung pakai order_id sebagai UUID)
      const [payment] = await db
        .select({ id: payments.id, status: payments.status, appointment_id: payments.appointmentId, total_amount: payments.totalAmount })
        .from(payments)
        .where(eq(payments.gatewayReference, orderId))
        .limit(1);

      if (!payment) {
        set.status = 404;
        return createErrorResponse('Webhook Error: Payment tidak ditemukan untuk order_id: ' + orderId);
      }
      if (payment.status === 'paid') return createSuccessResponse('Payment sudah lunas sebelumnya', null);

      if (payment.status === gatewayStatus.paymentStatus) {
        return createSuccessResponse('Webhook diterima tanpa perubahan status payment', {
          provider,
          provider_status: gatewayStatus.providerStatus,
          payment_status: payment.status
        });
      }

      if (gatewayStatus.paymentStatus !== 'paid') {
        await PaymentService.updatePaymentStatus(
          payment.id,
          gatewayStatus.paymentStatus,
          '00000000-0000-0000-0000-000000000000',
          'system'
        );

        return createSuccessResponse('Webhook status payment berhasil diperbarui', {
          provider,
          provider_status: gatewayStatus.providerStatus,
          payment_status: gatewayStatus.paymentStatus
        });
      }

      // Verifikasi nominal: gross_amount dari gateway harus sama dengan invoice yang
      // kita simpan. Mencegah order ditandai lunas dengan nominal berbeda. (M1)
      if (body.gross_amount != null) {
        const gross = Math.round(Number(body.gross_amount));
        const expected = Math.round(Number(payment.total_amount));
        if (!Number.isFinite(gross) || gross !== expected) {
          set.status = 400;
          return createErrorResponse(
            `Webhook Error: gross_amount (${body.gross_amount}) tidak sesuai invoice (${expected})`
          );
        }
      }

      await PaymentService.updatePaymentStatus(
        payment.id,
        'paid',
        '00000000-0000-0000-0000-000000000000',
        'system'
      );

      // Notifikasi barber bahwa pembayaran telah dikonfirmasi — barber tetap harus
      // menerima order secara eksplisit melalui endpoint verify-and-accept.
      if (payment.appointment_id) {
        try {
          const [apt] = await db
            .select({
              id: appointments.id,
              status: appointments.status,
              barber_id: appointments.barberId,
              branch_id: appointments.branchId,
              customer_id: appointments.customerId
            })
            .from(appointments)
            .where(eq(appointments.id, payment.appointment_id))
            .limit(1);

          // Refresh halaman "Pesanan" milik customer setelah webhook menandai lunas.
          if (apt) {
            emitAppointmentStatusChanged({
              appointment_id: apt.id,
              status: apt.status,
              raw_status: apt.status,
              barber_id: apt.barber_id ?? null,
              customer_id: apt.customer_id ?? null,
              branch_id: apt.branch_id ?? null,
              timestamp: new Date().toISOString()
            });
          }

          if (apt?.barber_id) {
            emitNewOrder(apt.barber_id, {
              appointment_id: payment.appointment_id,
              timestamp: new Date().toISOString()
            });
          }
        } catch (notifyErr: any) {
          logger.error({ err: notifyErr, paymentId: payment.id }, '[Webhook] Gagal notifikasi barber');
        }
      }

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
