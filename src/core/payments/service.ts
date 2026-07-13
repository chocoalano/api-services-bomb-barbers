import { db } from '../../lib/db';
import { snakeKeys, toDbDate } from '../../db/helpers';
import { isDuplicateKeyError } from '../../db/procedures';
import { invoices, appointments, customers, payments, appointmentServices } from '../../db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { AuditService } from '../../modules/admin/audit/service';
import { GatewayFactory } from './gateways/factory';
import { createHash, randomUUID } from 'node:crypto';
import {
  BranchServiceAreaService,
  normalizeLocation
} from '../branches/service-area.service';

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

      try {
        await db.insert(invoices).values({
          id: randomUUID(),
          paymentId,
          invoiceNumber,
          issuedAt: toDbDate(new Date()),
          publicAccessTokenHash: tokenHash,
          publicAccessExpiresAt: toDbDate(expiresAt)
        } as any);
        success = true;
      } catch (error: any) {
        const msg = String(error?.message ?? '');
        // Kompatibilitas sementara sebelum migration Tahap 1 diterapkan.
        if (msg.includes('public_access_token_hash') || msg.includes('public_access_expires_at')) {
          try {
            await db.insert(invoices).values({
              id: randomUUID(),
              paymentId,
              invoiceNumber,
              issuedAt: toDbDate(new Date())
            } as any);
            publicAccessToken = '';
            success = true;
          } catch {
            attempts++;
          }
        } else {
          attempts++;
        }
      }
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

// Biaya layanan platform. HARUS ditentukan server, tidak boleh dipercaya dari body.
const DEFAULT_SERVICE_FEE = 5000;

export class PaymentService {
  /**
   * Fetch customer details dari appointment untuk dikirim ke payment gateway.
   */
  private static async getCustomerDetails(appointmentId: string) {
    const [data] = await db
      .select({ fullName: customers.fullName, email: customers.email, phone: customers.phone })
      .from(appointments)
      .leftJoin(customers, eq(appointments.customerId, customers.id))
      .where(eq(appointments.id, appointmentId))
      .limit(1);

    if (!data || data.fullName == null) {
      return { name: 'Customer', email: 'noreply@bombbarbershop.com', phone: '' };
    }

    return {
      name: data.fullName || 'Customer',
      email: data.email || 'noreply@bombbarbershop.com',
      phone: data.phone || ''
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
    await db
      .update(payments)
      .set({ gatewayReference: transResponse.gateway_reference })
      .where(eq(payments.id, paymentId));

    return {
      payment_url: transResponse.payment_url,
      redirect_url: transResponse.redirect_url || transResponse.payment_url,
      token: transResponse.token || null,
      gateway_reference: transResponse.gateway_reference
    };
  }

  static async createPayment(payload: CreatePaymentPayload, actorId: string, actorType: 'admin' | 'customer') {
    const [aptRow] = await db
      .select({
        branch_id: appointments.branchId,
        barber_id: appointments.barberId,
        customer_id: appointments.customerId,
        fulfillment_type: appointments.fulfillmentType,
        destination_latitude: appointments.destinationLatitude,
        destination_longitude: appointments.destinationLongitude
      })
      .from(appointments)
      .where(eq(appointments.id, payload.appointment_id))
      .limit(1);

    if (!aptRow) throw new Error('Appointment tidak valid atau tidak ditemukan');

    const aptServices = await db
      .select({ price_amount: appointmentServices.priceAmount })
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, payload.appointment_id));
    const apt: any = { ...aptRow, appointment_services: aptServices };

    if (apt.fulfillment_type === 'home_service') {
      const destination = normalizeLocation(
        apt.destination_latitude,
        apt.destination_longitude,
        'destination_latitude',
        'destination_longitude'
      );
      await BranchServiceAreaService.assertBranchCanServeLocation(
        apt.branch_id,
        destination,
        {
          barberId: apt.barber_id,
          customerId: apt.customer_id ?? null,
          source: 'payment_create'
        }
      );
    }

    const serviceAmount = apt.appointment_services.reduce((sum: number, s: any) => sum + Number(s.price_amount), 0);

    // Diskon, service_fee, dan product_amount hanya boleh ditentukan oleh staff/admin
    // tepercaya (dari aturan/kupon tervalidasi). Body customer TIDAK dipercaya untuk
    // field yang menurunkan/menaikkan total, agar tidak bisa membayar lebih murah.
    const isPrivileged = actorType === 'admin';
    const productAmount = isPrivileged ? (payload.product_amount || 0) : 0;
    const discountAmount = isPrivileged ? (payload.discount_amount || 0) : 0;
    const serviceFee = isPrivileged && payload.service_fee != null ? payload.service_fee : DEFAULT_SERVICE_FEE;
    // A10: Fitur tip dinonaktifkan. tip_amount dipaksa 0 dan TIDAK diambil dari
    // input customer/body (server-trusted). Kolom DB tetap ada demi kompatibilitas.
    const tipAmount = 0;
    const deliveryFee = apt.fulfillment_type === 'home_service' ? 5000 : 0;

    // Diskon tidak boleh melebihi subtotal layanan + produk.
    const subtotal = serviceAmount + productAmount;
    if (discountAmount < 0 || discountAmount > subtotal) {
      throw new Error('Nilai diskon tidak valid');
    }

    const totalAmount = subtotal + serviceFee + deliveryFee + tipAmount - discountAmount;
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

    if (payload.status === 'paid') paymentRecord.paid_at = toDbDate(new Date());

    // ── Coba insert payment baru ──────────────────────────────────────────────
    const paymentId = randomUUID();
    let newPayment: any = null;
    let isDuplicate = false;
    try {
      await db.insert(payments).values({
        id: paymentId,
        appointmentId: paymentRecord.appointment_id,
        branchId: paymentRecord.branch_id,
        serviceAmount: paymentRecord.service_amount,
        productAmount: paymentRecord.product_amount,
        serviceFee: paymentRecord.service_fee,
        deliveryFee: paymentRecord.delivery_fee,
        discountAmount: paymentRecord.discount_amount,
        tipAmount: paymentRecord.tip_amount,
        totalAmount: paymentRecord.total_amount,
        method: paymentRecord.method,
        status: paymentRecord.status,
        gatewayReference: paymentRecord.gateway_reference,
        paidAt: paymentRecord.paid_at ?? null
      } as any);
      [newPayment] = snakeKeys(await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1));
    } catch (e: any) {
      if (isDuplicateKeyError(e)) isDuplicate = true;
      else throw new Error('Gagal mencatat pembayaran: ' + (e?.message ?? 'unknown'));
    }

    // ── Jika duplikat (payment sudah ada), update data dan lakukan re-tokenization ────────────
    if (isDuplicate) {
      // Ambil payment yang sudah ada
      const [existingPayment] = snakeKeys(
        await db.select().from(payments).where(eq(payments.appointmentId, payload.appointment_id)).limit(1)
      );

      if (!existingPayment) {
        throw new Error('Gagal mengambil data payment yang sudah ada');
      }

      // Jika sudah paid, tidak perlu re-tokenize
      if (existingPayment.status === 'paid') {
        throw new Error('Pembayaran untuk pesanan ini sudah lunas');
      }

      // UPDATE payment dengan amount terbaru (tip, service_fee, dll mungkin berubah)
      await db
        .update(payments)
        .set({
          serviceAmount,
          productAmount,
          serviceFee,
          deliveryFee,
          discountAmount,
          tipAmount,
          totalAmount,
          method: payload.method as any
        })
        .where(eq(payments.id, existingPayment.id));
      const [updatedPayment] = snakeKeys(
        await db.select().from(payments).where(eq(payments.id, existingPayment.id)).limit(1)
      );

      // Buat Snap token baru untuk payment yang sudah ada (menggunakan amount terbaru)
      let gatewayResult = { payment_url: null as string | null, redirect_url: null as string | null, token: null as string | null, gateway_reference: updatedPayment.gateway_reference };
      if (payload.provider && payload.method !== 'cash') {
        gatewayResult = await this.requestGatewayToken(
          payload.provider,
          updatedPayment.id,
          payload.appointment_id,
          updatedPayment.total_amount
        );
      }

      return {
        ...updatedPayment,
        gateway_reference: gatewayResult.gateway_reference,
        invoice_number: null,
        invoice_access_token: null,
        payment_url: gatewayResult.payment_url,
        redirect_url: gatewayResult.redirect_url,
        token: gatewayResult.token
      };
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

  static async updatePaymentStatus(id: string, newStatus: string, actorId: string, actorType: 'admin' | 'customer' | 'system' | 'barber' | 'staff') {
    const [oldPayment] = snakeKeys(await db.select().from(payments).where(eq(payments.id, id)).limit(1));
    if (!oldPayment) throw new Error('Payment tidak ditemukan');
    if (oldPayment.status === 'paid' && newStatus === 'paid') throw new Error('Payment sudah lunas');

    let newPayment: any;
    let invoiceNumber = null;

    if (newStatus === 'paid') {
      // Transisi pending→paid dijaga atomik agar confirm & webhook bersamaan hanya
      // menghasilkan SATU invoice (mencegah invoice ganda). `status <> 'paid'`
      // memastikan hanya satu pemanggil yang benar-benar mengubah baris. (M3)
      const res: any = await db
        .update(payments)
        .set({ status: 'paid', paidAt: oldPayment.paid_at || toDbDate(new Date()) })
        .where(and(eq(payments.id, id), ne(payments.status, 'paid')));
      const affected = (Array.isArray(res) ? res[0]?.affectedRows : res?.affectedRows) ?? 0;
      if (!affected) throw new Error('Payment sudah lunas'); // kalah race — sudah dibayar proses lain

      [newPayment] = snakeKeys(await db.select().from(payments).where(eq(payments.id, id)).limit(1));
      const invoice = await InvoiceService.generateInvoice(newPayment.id, newPayment.branch_id);
      invoiceNumber = invoice.invoiceNumber;
      (newPayment as any).invoice_access_token = invoice.publicAccessToken;
    } else {
      await db.update(payments).set({ status: newStatus as any }).where(eq(payments.id, id));
      [newPayment] = snakeKeys(await db.select().from(payments).where(eq(payments.id, id)).limit(1));
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
