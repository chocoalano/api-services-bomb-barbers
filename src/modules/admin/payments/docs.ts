import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonMutationErrors,
  requestExamples,
  uuidField
} from '../swagger';

const paymentExample = {
  id: ADMIN_EXAMPLES.paymentId,
  appointment_id: ADMIN_EXAMPLES.appointmentId,
  branch_id: ADMIN_EXAMPLES.branchId,
  service_amount: 75000,
  product_amount: 25000,
  discount_amount: 10000,
  tip_amount: 5000,
  total_amount: 95000,
  method: 'qris',
  status: 'pending',
  gateway_reference: 'MIDTRANS-BBBBBBBB',
  paid_at: null,
  created_at: '2026-06-20T11:00:00.000Z',
  updated_at: '2026-06-20T11:00:00.000Z',
  invoice_number: null,
  payment_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  token: 'SNAP-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

const webhookBody = t.Object({
  provider: t.Optional(t.UnionEnum(['midtrans', 'xendit'], {
    description: 'Provider gateway. Dipakai terutama pada fixed webhook URL.',
    examples: ['midtrans']
  })),
  order_id: t.Optional(t.String({
    description: 'Payment UUID dari callback Midtrans.',
    examples: [ADMIN_EXAMPLES.paymentId]
  })),
  external_id: t.Optional(t.String({
    description: 'Payment UUID dari callback Xendit.',
    examples: [ADMIN_EXAMPLES.paymentId]
  })),
  status_code: t.Optional(t.String({
    description: 'Status HTTP transaksi Midtrans. Nilai 200 menandakan settlement pada mock gateway saat ini.',
    examples: ['200']
  })),
  transaction_status: t.Optional(t.String({
    description: 'Status transaksi Midtrans.',
    examples: ['settlement']
  })),
  status: t.Optional(t.String({
    description: 'Status callback Xendit. Nilai PAID menandakan pembayaran berhasil.',
    examples: ['PAID']
  })),
  gross_amount: t.Optional(t.String({
    description: 'Nominal transaksi dari provider.',
    examples: ['95000.00']
  }))
}, {
  additionalProperties: true,
  examples: [
    {
      order_id: ADMIN_EXAMPLES.paymentId,
      status_code: '200',
      transaction_status: 'settlement',
      gross_amount: '95000.00'
    },
    {
      provider: 'xendit',
      external_id: ADMIN_EXAMPLES.paymentId,
      status: 'PAID'
    }
  ]
});

export const paymentDocs = {
  adminCreatePayment: {
    params: t.Object({
      id: uuidField('UUID appointment yang akan dibayar.', ADMIN_EXAMPLES.appointmentId)
    }),
    body: t.Object({
      method: t.UnionEnum(['cash', 'qris', 'card', 'bank_transfer', 'ewallet'], {
        description: 'Metode pembayaran.',
        examples: ['qris']
      }),
      status: t.UnionEnum(['pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded'], {
        description: 'Status awal pembayaran. Gunakan paid untuk pembayaran cash yang sudah diterima.',
        examples: ['pending']
      }),
      provider: t.Optional(t.UnionEnum(['midtrans', 'xendit'], {
        description: 'Payment gateway untuk metode non-cash.',
        examples: ['midtrans']
      })),
      product_amount: t.Optional(t.Integer({
        minimum: 0,
        description: 'Subtotal produk dalam rupiah penuh.',
        examples: [25000]
      })),
      discount_amount: t.Optional(t.Integer({
        minimum: 0,
        description: 'Total diskon dalam rupiah penuh.',
        examples: [10000]
      })),
      tip_amount: t.Optional(t.Integer({
        minimum: 0,
        description: 'Tip barber dalam rupiah penuh.',
        examples: [5000]
      })),
      gateway_reference: t.Optional(t.String({
        description: 'Referensi eksternal jika transaksi sudah dibuat di provider lain.',
        examples: ['EXTERNAL-TRX-001']
      }))
    }, requestExamples(
      {
        method: 'cash',
        status: 'paid'
      },
      {
        method: 'qris',
        status: 'pending',
        provider: 'midtrans',
        product_amount: 25000,
        discount_amount: 10000,
        tip_amount: 5000,
        gateway_reference: 'EXTERNAL-TRX-001'
      }
    )),
    detail: adminDetail({
      tag: ADMIN_TAGS.payments,
      summary: 'Buat Pembayaran Appointment',
      description: 'Menghitung ulang subtotal layanan dari snapshot appointment_services, menambahkan produk dan tip, mengurangi diskon, lalu mencatat payment dan audit log.',
      required: ['path id', 'method', 'status', 'Authorization: Bearer <access_token>', 'scope cabang appointment'],
      optional: ['provider', 'product_amount', 'discount_amount', 'tip_amount', 'gateway_reference'],
      successStatus: 201,
      successMessage: 'Pembayaran berhasil dicatat',
      successData: paymentExample,
      errors: [
        ...commonMutationErrors,
        {
          status: 409,
          description: 'Appointment sudah memiliki payment.',
          message: 'Pembayaran untuk pesanan ini sudah pernah dibuat sebelumnya (Double Pay Protection)'
        }
      ]
    })
  },
  adminGetPaymentDetail: {
    params: t.Object({
      id: uuidField('UUID payment.', ADMIN_EXAMPLES.paymentId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.payments,
      summary: 'Detail Pembayaran',
      description: 'Mengambil payment beserta appointment dan invoice yang terkait.',
      required: ['path id', 'Authorization: Bearer <access_token>', 'scope cabang payment'],
      optional: [],
      successMessage: 'Detail pembayaran',
      successData: {
        ...paymentExample,
        appointments: {
          id: ADMIN_EXAMPLES.appointmentId,
          branch_id: ADMIN_EXAMPLES.branchId,
          barber_id: ADMIN_EXAMPLES.barberId,
          customer_id: ADMIN_EXAMPLES.customerId,
          source: 'walk_in',
          status: 'completed'
        },
        invoices: {
          invoice_number: ADMIN_EXAMPLES.invoiceNumber,
          pdf_url: null
        }
      },
      errors: [
        ...commonMutationErrors,
        {
          status: 404,
          description: 'Payment tidak ditemukan.',
          message: 'Pembayaran tidak ditemukan'
        }
      ]
    })
  },
  adminGetBranchPayments: {
    params: t.Object({
      branchId: uuidField('UUID cabang.', ADMIN_EXAMPLES.branchId)
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.payments,
      summary: 'Daftar Pembayaran Cabang',
      description: 'Mengambil seluruh transaksi cabang dari yang terbaru, termasuk nomor invoice jika sudah diterbitkan.',
      required: ['path branchId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      successMessage: 'Transaksi Cabang',
      successData: [
        {
          ...paymentExample,
          status: 'paid',
          paid_at: '2026-06-20T11:05:00.000Z',
          invoices: { invoice_number: ADMIN_EXAMPLES.invoiceNumber }
        }
      ],
      errors: commonMutationErrors
    })
  },
  webhookWithProvider: {
    params: t.Object({
      provider: t.UnionEnum(['midtrans', 'xendit'], {
        description: 'Nama payment gateway.',
        examples: ['midtrans']
      })
    }),
    body: webhookBody,
    detail: adminDetail({
      tag: ADMIN_TAGS.webhooks,
      summary: 'Terima Webhook Payment Gateway',
      description: 'Menerima callback provider, memverifikasi signature dari header, menandai payment paid, membuat invoice, dan mencatat audit log.',
      required: ['path provider', 'signature header', 'order_id untuk Midtrans atau external_id untuk Xendit'],
      optional: ['provider body', 'status_code', 'transaction_status', 'status', 'gross_amount', 'field tambahan provider'],
      security: false,
      successMessage: 'Webhook berhasil diproses',
      successData: null,
      errors: [
        {
          status: 401,
          description: 'Signature webhook tidak valid.',
          message: 'Invalid signature'
        },
        {
          status: 500,
          description: 'Payload provider tidak dapat diproses atau payment tidak ditemukan.',
          message: 'Webhook Error: Payment tidak ditemukan'
        }
      ]
    })
  },
  webhookFixed: {
    body: webhookBody,
    detail: adminDetail({
      tag: ADMIN_TAGS.webhooks,
      summary: 'Terima Webhook pada Fixed URL',
      description: 'Endpoint kompatibilitas untuk dashboard gateway yang hanya mendukung satu URL callback. Jika provider tidak dikirim, backend memakai Midtrans.',
      required: ['signature header', 'order_id atau external_id'],
      optional: ['provider', 'status_code', 'transaction_status', 'status', 'gross_amount', 'field tambahan provider'],
      security: false,
      successMessage: 'Webhook berhasil diproses',
      successData: null,
      errors: [
        {
          status: 401,
          description: 'Signature webhook tidak valid.',
          message: 'Invalid signature'
        },
        {
          status: 500,
          description: 'Payload provider tidak dapat diproses.',
          message: 'Webhook Error: Payment ID tidak ditemukan di payload webhook'
        }
      ]
    })
  }
};
