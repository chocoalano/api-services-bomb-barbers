import { t } from 'elysia';

export const paymentDocs = {
  adminCreatePayment: {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      method: t.String(),
      status: t.String(),
      provider: t.Optional(t.String()),
      product_amount: t.Optional(t.Number()),
      discount_amount: t.Optional(t.Number()),
      tip_amount: t.Optional(t.Number()),
      gateway_reference: t.Optional(t.String())
    }),
    detail: { tags: ['Admin Payments'], summary: 'Create Payment' }
  },
  adminGetPaymentDetail: {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Admin Payments'], summary: 'Get Payment Details' }
  },
  adminGetBranchPayments: {
    params: t.Object({ branchId: t.String() }),
    detail: { tags: ['Admin Payments'], summary: 'Get Branch Payments' }
  },
  customerGetPayment: {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Customer Payments'], summary: 'Get Payment Details' }
  },
  customerCreatePayment: {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      method: t.String({
        description: 'Metode pembayaran yang dipilih pelanggan, misalnya qris, bank_transfer, ewallet, atau cash jika kasir membantu proses pembayaran.'
      }),
      provider: t.Optional(t.String({
        description: 'Nama payment gateway yang digunakan, misalnya midtrans atau xendit. Jika metode non-cash dikirim, backend akan membuat transaksi ke provider ini dari sisi server agar credential gateway tidak pernah berada di aplikasi mobile.'
      })),
      tip_amount: t.Optional(t.Integer({
        minimum: 0,
        description: 'Nominal tip dalam rupiah penuh. Gunakan integer, bukan pecahan desimal.'
      }))
    }),
    detail: { tags: ['Customer Payments'], summary: 'Inisiasi Pembayaran Customer', description: 'Menginisiasi pembayaran aman untuk satu appointment milik pelanggan yang sedang login. Endpoint ini menghitung ulang total tagihan dari snapshot layanan di backend, menambahkan tip jika ada, membuat record payment, mencatat audit finansial, lalu mengembalikan payment_url, redirect_url, dan token gateway bila provider seperti Midtrans menghasilkan sesi pembayaran.' }
  },
  getInvoice: {
    params: t.Object({ invoiceNumber: t.String() }),
    detail: { tags: ['Public Invoices'], summary: 'Get Invoice' }
  }
};
