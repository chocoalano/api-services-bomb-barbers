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

const messageExample = {
  id: CUSTOMER_EXAMPLES.chatMessageId,
  appointment_id: CUSTOMER_EXAMPLES.appointmentId,
  sender_id: CUSTOMER_EXAMPLES.customerId,
  sender_role: 'customer',
  text: 'Saya sudah dalam perjalanan ke cabang.',
  created_at: '2026-06-25T02:30:00.000Z'
};

export const chatDocs = {
  getChatHistory: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment yang riwayat chat-nya akan dibaca.',
        CUSTOMER_EXAMPLES.appointmentId
      )
    }),
    query: t.Object({
      page: t.Optional(t.Numeric({
        minimum: 1,
        default: 1,
        description: 'Nomor halaman riwayat chat. Default 1.',
        examples: [1]
      })),
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 100,
        default: 20,
        description: 'Jumlah pesan per halaman. Default 20, maksimum 100.',
        examples: [20]
      }))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.chat,
      summary: 'Riwayat Chat Appointment',
      description: 'Mengambil pesan chat pada appointment yang dimiliki customer. Pesan diurutkan dari paling lama ke paling baru dan dapat dimuat bertahap menggunakan page serta limit.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id'],
      optional: ['query.page', 'query.limit'],
      successMessage: 'Riwayat chat berhasil diambil',
      successData: [messageExample],
      errors: [
        customerAuthError,
        customerValidationError,
        customerServerError
      ]
    })
  },

  sendMessage: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment tujuan pesan.',
        CUSTOMER_EXAMPLES.appointmentId
      )
    }),
    body: t.Object({
      text: t.Optional(t.String({
        minLength: 1,
        description: 'Isi pesan. Field utama yang direkomendasikan untuk aplikasi baru.',
        examples: ['Saya sudah dalam perjalanan ke cabang.']
      })),
      message: t.Optional(t.String({
        minLength: 1,
        description: 'Alias dari text untuk kompatibilitas client lama. Minimal salah satu text atau message harus berisi pesan.',
        examples: ['Saya sudah dalam perjalanan ke cabang.']
      }))
    }, {
      examples: [
        {
          text: 'Saya sudah dalam perjalanan ke cabang.'
        },
        {
          message: 'Apakah jadwal saya tetap pukul 10.00?'
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.chat,
      summary: 'Kirim Pesan Chat Appointment',
      description: 'Menyimpan pesan customer pada appointment dan mengirim event realtime setelah berhasil. Backend memastikan customer merupakan pemilik appointment. Gunakan text untuk client baru; message tetap didukung sebagai alias.',
      required: [
        'Authorization: Bearer <customer_access_token>',
        'path.id',
        'salah satu dari body.text atau body.message'
      ],
      optional: ['body.text jika memakai message', 'body.message jika memakai text'],
      successStatus: 201,
      successMessage: 'Pesan chat berhasil dikirim',
      successData: messageExample,
      errors: [
        customerAuthError,
        customerValidationError,
        customerServerError
      ]
    })
  }
};
