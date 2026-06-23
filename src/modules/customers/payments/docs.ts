import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerAuthError,
  customerDetail,
  customerServerError,
  customerUuidField,
  customerValidationError
} from '../swagger';

const paymentExample = {
  id: CUSTOMER_EXAMPLES.paymentId,
  appointment_id: CUSTOMER_EXAMPLES.appointmentId,
  branch_id: CUSTOMER_EXAMPLES.branchId,
  service_amount: 85000,
  product_amount: 0,
  discount_amount: 0,
  tip_amount: 20000,
  total_amount: 105000,
  method: 'qris',
  status: 'pending',
  gateway_reference: 'MIDTRANS-ORDER-20260620-001',
  paid_at: null,
  created_at: '2026-06-20T08:30:00.000Z',
  updated_at: '2026-06-20T08:30:00.000Z',
  invoice_number: null,
  payment_url: 'https://app.sandbox.midtrans.com/snap/v4/redirection/example-token',
  redirect_url: 'https://app.sandbox.midtrans.com/snap/v4/redirection/example-token',
  token: 'example-midtrans-snap-token'
};

export const paymentDocs = {
  customerGetPayment: {
    params: t.Object({
      id: customerUuidField(
        'UUID payment yang akan dibaca. Payment harus terkait appointment milik customer.',
        CUSTOMER_EXAMPLES.paymentId
      )
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.payments,
      summary: 'Detail Pembayaran Customer',
      description: 'Mengambil detail payment berdasarkan UUID dengan pembatasan kepemilikan melalui relasi appointment. Response menyertakan nominal rupiah, metode, status, referensi gateway, dan invoice jika sudah tersedia.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id'],
      successMessage: 'Detail Pembayaran',
      successData: {
        ...paymentExample,
        appointments: {
          customer_id: CUSTOMER_EXAMPLES.customerId
        },
        invoices: [
          {
            invoice_number: CUSTOMER_EXAMPLES.invoiceNumber,
            pdf_url: null
          }
        ]
      },
      errors: [
        customerAuthError,
        {
          status: 404,
          description: 'Payment tidak ditemukan atau tidak terkait appointment milik customer.',
          message: 'Pembayaran tidak valid atau bukan milik Anda'
        },
        customerServerError
      ]
    })
  },

  customerCreatePayment: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment milik customer yang akan dibayar.',
        CUSTOMER_EXAMPLES.appointmentId
      )
    }),
    body: t.Object({
      method: t.String({
        minLength: 1,
        description: 'Metode pembayaran, misalnya qris, bank_transfer, ewallet, atau cash.',
        examples: ['qris']
      }),
      provider: t.Optional(t.String({
        description: 'Payment gateway untuk pembayaran non-cash, misalnya midtrans atau xendit.',
        examples: ['midtrans']
      })),
      tip_amount: t.Optional(t.Integer({
        minimum: 0,
        description: 'Nominal tip dalam rupiah penuh. Default 0.',
        examples: [20000]
      }))
    }, {
      examples: [
        {
          method: 'cash'
        },
        {
          method: 'qris',
          provider: 'midtrans',
          tip_amount: 20000
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.payments,
      summary: 'Inisiasi Pembayaran Appointment',
      description: 'Menginisiasi pembayaran untuk appointment milik customer. Backend menghitung ulang total dari snapshot layanan, menambahkan tip, membuat payment berstatus pending, mencatat audit finansial, dan meminta sesi pembayaran ke gateway jika provider non-cash dikirim. Credential gateway tidak pernah dikirim ke aplikasi.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id', 'body.method'],
      optional: ['body.provider', 'body.tip_amount'],
      successStatus: 201,
      successDescription: 'Payment berhasil dibuat dan sesi gateway tersedia jika diperlukan.',
      successMessage: 'Inisiasi pembayaran berhasil',
      successData: paymentExample,
      errors: [
        customerAuthError,
        customerValidationError,
        {
          status: 400,
          description: 'Appointment sudah memiliki payment yang lunas sehingga tidak bisa membuat token baru.',
          message: 'Pembayaran untuk pesanan ini sudah lunas'
        },
        customerServerError
      ]
    })
  },

  getInvoice: {
    params: t.Object({
      invoiceNumber: t.String({
        minLength: 1,
        description: 'Nomor invoice yang diterbitkan setelah pembayaran berstatus paid.',
        examples: [CUSTOMER_EXAMPLES.invoiceNumber]
      })
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.payments,
      summary: 'Lihat Nota Pembayaran',
      description: 'Mengambil nota berdasarkan nomor invoice dengan memastikan invoice terkait appointment milik customer pada JWT. Response hanya memuat data pembayaran, appointment, dan cabang yang diperlukan untuk tampilan nota.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.invoiceNumber'],
      successMessage: 'Nota Pembayaran',
      successData: {
        id: '12121212-1212-4212-8212-121212121212',
        invoice_number: CUSTOMER_EXAMPLES.invoiceNumber,
        issued_at: '2026-06-20T08:40:00.000Z',
        pdf_url: null,
        payment: {
          id: CUSTOMER_EXAMPLES.paymentId,
          total_amount: 105000,
          service_amount: 85000,
          product_amount: 0,
          discount_amount: 0,
          tip_amount: 20000,
          method: 'qris',
          status: 'paid',
          paid_at: '2026-06-20T08:40:00.000Z',
          appointment: {
            id: CUSTOMER_EXAMPLES.appointmentId,
            status: 'completed',
            branch: {
              id: CUSTOMER_EXAMPLES.branchId,
              name: 'Bomb Barbershop Senopati'
            }
          }
        }
      },
      errors: [
        customerAuthError,
        {
          status: 404,
          description: 'Nomor invoice tidak ditemukan atau bukan milik customer.',
          message: 'Invoice tidak ditemukan'
        },
        customerServerError
      ]
    })
  },

  getPublicInvoice: {
    params: t.Object({
      invoiceNumber: t.String({
        minLength: 1,
        description: 'Nomor invoice yang diterbitkan setelah pembayaran lunas.',
        examples: [CUSTOMER_EXAMPLES.invoiceNumber]
      })
    }),
    query: t.Object({
      token: t.Optional(t.String({
        minLength: 32,
        description: 'Token akses publik berentropi tinggi yang diterbitkan bersama invoice dan memiliki waktu kedaluwarsa.',
        examples: ['11111111-1111-4111-8111-11111111111122222222222222222222222222222222']
      }))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.payments,
      summary: 'Lihat Nota melalui Tautan Publik Terbatas',
      description: 'Mengambil nota melalui token publik yang disimpan dalam bentuk hash. Response sudah disensor dan tidak mengembalikan data pribadi customer atau detail appointment yang tidak diperlukan.',
      required: ['path.invoiceNumber', 'query.token'],
      successMessage: 'Nota Pembayaran',
      successData: {
        id: '12121212-1212-4212-8212-121212121212',
        invoice_number: CUSTOMER_EXAMPLES.invoiceNumber,
        issued_at: '2026-06-20T08:40:00.000Z',
        pdf_url: null,
        payment: {
          id: CUSTOMER_EXAMPLES.paymentId,
          total_amount: 105000,
          service_amount: 85000,
          product_amount: 0,
          discount_amount: 0,
          tip_amount: 20000,
          method: 'qris',
          status: 'paid',
          paid_at: '2026-06-20T08:40:00.000Z',
          appointment: {
            id: CUSTOMER_EXAMPLES.appointmentId,
            status: 'completed',
            branch: {
              id: CUSTOMER_EXAMPLES.branchId,
              name: 'Bomb Barbershop Senopati'
            }
          }
        }
      },
      security: false,
      errors: [
        {
          status: 401,
          description: 'Token tidak dikirim atau tidak cocok.',
          message: 'Token akses invoice tidak valid'
        },
        {
          status: 404,
          description: 'Invoice publik tidak ditemukan atau migration token belum diterapkan.',
          message: 'Invoice publik tidak tersedia'
        },
        {
          status: 410,
          description: 'Token publik sudah melewati waktu kedaluwarsa.',
          message: 'Token akses invoice sudah kedaluwarsa'
        },
        customerServerError
      ]
    })
  }
};
