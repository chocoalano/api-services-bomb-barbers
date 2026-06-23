import { t } from 'elysia';
import {
  BARBER_EXAMPLES,
  BARBER_TAGS,
  barberAuthError,
  barberDetail,
  barberRoleError,
  barberServerError,
  barberUuidField,
  barberValidationError
} from '../swagger';

const messageExample = {
  id: BARBER_EXAMPLES.messageId,
  appointment_id: BARBER_EXAMPLES.appointmentId,
  sender_id: BARBER_EXAMPLES.staffId,
  sender_role: 'barber',
  text: 'Saya tiba sekitar 15 menit lagi.',
  created_at: '2026-06-25T02:30:00.000Z'
};

export const chatDocs = {
  getChatHistory: {
    params: t.Object({
      id: barberUuidField(
        'UUID appointment yang ditugaskan kepada barber.',
        BARBER_EXAMPLES.appointmentId
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
    detail: barberDetail({
      tag: BARBER_TAGS.chat,
      summary: 'Riwayat Chat Appointment Barber',
      description: 'Mengambil pesan chat pada appointment yang memang ditugaskan kepada barber. Pesan diurutkan dari yang paling lama ke terbaru dan mendukung pagination.',
      required: ['Authorization: Bearer <barber_access_token>', 'path.id'],
      optional: ['query.page', 'query.limit'],
      successMessage: 'Riwayat chat berhasil diambil',
      successData: [messageExample],
      errors: [
        barberAuthError,
        barberRoleError,
        barberValidationError,
        barberServerError
      ]
    })
  },

  sendMessage: {
    params: t.Object({
      id: barberUuidField(
        'UUID appointment tujuan pesan.',
        BARBER_EXAMPLES.appointmentId
      )
    }),
    body: t.Object({
      text: t.Optional(t.String({
        minLength: 1,
        description: 'Isi pesan utama untuk client baru.',
        examples: ['Saya tiba sekitar 15 menit lagi.']
      })),
      message: t.Optional(t.String({
        minLength: 1,
        description: 'Alias text untuk kompatibilitas client lama.',
        examples: ['Saya tiba sekitar 15 menit lagi.']
      }))
    }, {
      examples: [
        {
          text: 'Saya tiba sekitar 15 menit lagi.'
        },
        {
          message: 'Mohon tunggu di area resepsionis.'
        }
      ]
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.chat,
      summary: 'Kirim Pesan Chat sebagai Barber',
      description: 'Menyimpan pesan barber pada appointment dan menyiarkan event realtime. Backend memverifikasi bahwa staff memiliki profil barber dan barber tersebut ditugaskan pada appointment.',
      required: [
        'Authorization: Bearer <barber_access_token>',
        'path.id',
        'salah satu dari body.text atau body.message'
      ],
      optional: ['body.text jika memakai message', 'body.message jika memakai text'],
      successStatus: 201,
      successMessage: 'Pesan chat berhasil dikirim',
      successData: messageExample,
      errors: [
        barberAuthError,
        barberRoleError,
        barberValidationError,
        barberServerError
      ]
    })
  }
};
