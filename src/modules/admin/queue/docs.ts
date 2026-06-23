import { t } from 'elysia';
import {
  ADMIN_EXAMPLES,
  ADMIN_TAGS,
  adminDetail,
  commonAuthErrors,
  uuidField
} from '../swagger';

export const queueDocs = {
  stream: {
    params: t.Object({
      branchId: uuidField(
        'UUID cabang yang antreannya ingin dipantau.',
        ADMIN_EXAMPLES.branchId
      )
    }),
    detail: adminDetail({
      tag: ADMIN_TAGS.queue,
      summary: 'Streaming Antrean Cabang',
      description: 'Membuka koneksi Server-Sent Events. Server mengirim event queue_update setiap sekitar lima detik selama koneksi aktif.',
      required: ['path branchId', 'Authorization: Bearer <access_token>', 'scope cabang'],
      optional: [],
      contentType: 'text/event-stream',
      rawSuccessExample: 'data: {"type":"queue_update","data":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","barber_id":"66666666-6666-4666-8666-666666666666","status":"in_queue","customer_id":"77777777-7777-4777-8777-777777777777","eta":{"eta_minutes":12}}]}\\n\\n',
      successDescription: 'Koneksi SSE berhasil dibuka dan event antrean dikirim berulang.',
      errors: commonAuthErrors
    })
  }
};
