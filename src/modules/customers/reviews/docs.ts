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

export const reviewDocs = {
  customerCreateReview: {
    params: t.Object({
      id: customerUuidField(
        'UUID appointment completed yang akan diberi ulasan.',
        CUSTOMER_EXAMPLES.appointmentId
      )
    }),
    body: t.Object({
      rating: t.Numeric({
        minimum: 1,
        maximum: 5,
        description: 'Rating layanan dan barber dari 1 sampai 5.',
        examples: [5]
      }),
      comment: t.Optional(t.String({
        description: 'Komentar customer mengenai pengalaman layanan.',
        examples: ['Hasil potongannya rapi dan barber sangat komunikatif.']
      })),
      photo_url: t.Optional(t.String({
        format: 'uri',
        description: 'URL foto hasil layanan yang sebelumnya diunggah melalui endpoint media.',
        examples: [CUSTOMER_EXAMPLES.imageUrl]
      })),
      tip_amount: t.Optional(t.Integer({
        minimum: 0,
        description: 'Nominal tip dalam rupiah penuh. Field diterima untuk kebutuhan UI, tetapi mutasi finansial tetap harus diproses melalui endpoint pembayaran.',
        examples: [20000]
      }))
    }, {
      examples: [
        {
          rating: 5
        },
        {
          rating: 5,
          comment: 'Hasil potongannya rapi dan barber sangat komunikatif.',
          photo_url: CUSTOMER_EXAMPLES.imageUrl,
          tip_amount: 20000
        }
      ]
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.reviews,
      summary: 'Buat Ulasan Appointment',
      description: 'Menyimpan satu ulasan untuk appointment completed milik customer. Backend memastikan appointment dimiliki customer, memiliki barber, belum pernah diulas, lalu memperbarui rating rata-rata dan jumlah rating barber.',
      required: ['Authorization: Bearer <customer_access_token>', 'path.id', 'body.rating'],
      optional: ['body.comment', 'body.photo_url', 'body.tip_amount'],
      successStatus: 201,
      successMessage: 'Ulasan berhasil disimpan',
      successData: {
        id: CUSTOMER_EXAMPLES.reviewId,
        appointment_id: CUSTOMER_EXAMPLES.appointmentId,
        customer_id: CUSTOMER_EXAMPLES.customerId,
        barber_id: CUSTOMER_EXAMPLES.barberId,
        branch_id: CUSTOMER_EXAMPLES.branchId,
        rating: 5,
        comment: 'Hasil potongannya rapi dan barber sangat komunikatif.',
        photo_url: CUSTOMER_EXAMPLES.imageUrl,
        created_at: '2026-06-25T05:00:00.000Z'
      },
      errors: [
        customerAuthError,
        customerValidationError,
        {
          status: 409,
          description: 'Customer sudah pernah memberikan ulasan untuk appointment yang sama.',
          message: 'Conflict',
          errors: 'Anda sudah memberikan ulasan untuk appointment ini.'
        },
        customerServerError
      ]
    })
  }
};
