import { t } from 'elysia';
import { BARBER_TAGS, barberDetail } from '../swagger';

const OPEN_ORDER_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];

export const openOrderDocs = {
  list: {
    query: t.Object({
      date: t.Optional(t.String({
        description: 'Tanggal Open Order (YYYY-MM-DD, zona Asia/Jakarta). Default hari ini.',
        examples: ['2026-07-11']
      }))
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.appointments,
      summary: 'Daftar Open Order Barber',
      description: 'Menampilkan periode Open Order yang telah dibuka barber pada tanggal tertentu, beserta seluruh opsi slot yang tersedia (kelipatan 2 jam, 08:00–22:00).',
      optional: ['date']
    })
  },

  open: {
    body: t.Object({
      order_date: t.Optional(t.String({
        description: 'Tanggal periode Open Order (YYYY-MM-DD). Default hari ini (Asia/Jakarta).',
        examples: ['2026-07-11']
      })),
      start_times: t.Optional(t.Array(t.String(), {
        description: `Daftar jam Open Order yang dibuka. Hanya kelipatan 2 jam: ${OPEN_ORDER_SLOTS.join(', ')}.`,
        examples: [['08:00', '10:00']]
      })),
      start_time: t.Optional(t.String({
        description: 'Alternatif single jam Open Order bila hanya membuka satu periode.',
        examples: ['08:00']
      }))
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.appointments,
      summary: 'Buka Open Order',
      description: 'Barber membuka satu atau beberapa periode Open Order. Jam WAJIB kelipatan 2 jam (08:00, 10:00, …, 22:00). Periode 08:00 mencakup booking customer 08:00 & 09:00, dst. Periode 22:00 hanya mencakup 22:00. Jam di luar kelipatan 2 jam ditolak.',
      required: ['start_times'],
      optional: ['order_date'],
      successStatus: 201
    })
  },

  close: {
    body: t.Object({
      order_date: t.Optional(t.String({
        description: 'Tanggal periode Open Order (YYYY-MM-DD). Default hari ini.',
        examples: ['2026-07-11']
      })),
      start_time: t.String({
        description: 'Jam periode Open Order yang ingin ditutup (kelipatan 2 jam).',
        examples: ['08:00']
      })
    }),
    detail: barberDetail({
      tag: BARBER_TAGS.appointments,
      summary: 'Tutup Open Order',
      description: 'Barber menutup satu periode Open Order sehingga tidak lagi menerima booking customer pada periode tersebut.',
      required: ['start_time'],
      optional: ['order_date']
    })
  }
};
