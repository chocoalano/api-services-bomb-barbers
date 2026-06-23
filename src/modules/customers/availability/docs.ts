import { t } from 'elysia';
import {
  CUSTOMER_EXAMPLES,
  CUSTOMER_TAGS,
  customerDateField,
  customerDetail,
  customerServerError,
  customerUuidField,
  customerValidationError
} from '../swagger';

export const availabilityDocs = {
  getAvailableSlots: {
    params: t.Object({
      id: customerUuidField(
        'UUID cabang yang akan dihitung ketersediaan jadwalnya.',
        CUSTOMER_EXAMPLES.branchId
      )
    }),
    query: t.Object({
      date: customerDateField(
        'Tanggal booking dalam format YYYY-MM-DD. Perhitungan jam menggunakan zona waktu operasional WIB (+07:00).',
        '2026-06-25'
      ),
      service_ids: t.ArrayQuery(customerUuidField(
        'UUID layanan. Dapat dikirim sebagai query berulang atau array query Elysia.',
        CUSTOMER_EXAMPLES.serviceId
      ), {
        minItems: 1,
        description: 'Minimal satu layanan wajib dipilih. Durasi seluruh layanan dijumlahkan untuk menentukan panjang slot.',
        examples: [[CUSTOMER_EXAMPLES.serviceId, CUSTOMER_EXAMPLES.secondServiceId]]
      }),
      barber_id: t.Optional(customerUuidField(
        'UUID barber pilihan. Jika tidak dikirim, slot dianggap tersedia ketika minimal satu barber cabang masih kosong.',
        CUSTOMER_EXAMPLES.barberId
      )),
      slot_interval_min: t.Optional(t.Numeric({
        minimum: 5,
        maximum: 120,
        default: 30,
        description: 'Jarak antar kandidat waktu mulai dalam menit. Default 30, minimum 5, maksimum 120.',
        examples: [15]
      })),
      fulfillment_type: t.Optional(t.UnionEnum(['in_store', 'home_service'], {
        default: 'in_store',
        description: 'Mode layanan. home_service memperluas blok jadwal dengan travel buffer.',
        examples: ['home_service']
      })),
      travel_buffer_min: t.Optional(t.Numeric({
        minimum: 0,
        maximum: 120,
        description: 'Buffer perjalanan sebelum dan sesudah home_service. Diabaikan untuk in_store.',
        examples: [15]
      }))
    }),
    detail: customerDetail({
      tag: CUSTOMER_TAGS.availability,
      summary: 'Lihat Slot Booking Tersedia',
      description: 'Menghitung slot booking berdasarkan jam operasional cabang, total durasi layanan, appointment aktif, exclusion window barber, barber aktif, dan cuti barber. Untuk home_service, travel buffer diterapkan sebelum dan sesudah layanan agar slot frontend konsisten dengan RPC booking atomik. Jika jam operasional belum tersedia, backend menggunakan fallback 09:00–21:00 WIB. Slot yang sudah lewat tidak dikembalikan.',
      required: ['path.id', 'query.date', 'query.service_ids (minimal satu UUID)'],
      optional: ['query.barber_id', 'query.slot_interval_min', 'query.fulfillment_type', 'query.travel_buffer_min'],
      successMessage: 'Slot jam tersedia berhasil diambil',
      successData: {
        branch_id: CUSTOMER_EXAMPLES.branchId,
        date: '2026-06-25',
        timezone_offset: '+07:00',
        service_ids: [CUSTOMER_EXAMPLES.serviceId, CUSTOMER_EXAMPLES.secondServiceId],
        barber_id: CUSTOMER_EXAMPLES.barberId,
        fulfillment_type: 'home_service',
        travel_buffer_min: 15,
        duration_min: 75,
        slot_interval_min: 15,
        operating_hours: {
          open_time: '09:00:00',
          close_time: '21:00:00'
        },
        slots: [
          {
            start_at: '2026-06-25T03:00:00.000Z',
            end_at: '2026-06-25T04:15:00.000Z',
            label: '10.00 - 11.15',
            available_barber_count: 1,
            available_barber_ids: [CUSTOMER_EXAMPLES.barberId]
          }
        ]
      },
      security: false,
      errors: [
        customerValidationError,
        {
          status: 404,
          description: 'Cabang atau layanan tidak ditemukan/tidak aktif.',
          message: 'Cabang tidak ditemukan atau tidak aktif'
        },
        customerServerError
      ]
    })
  }
};
