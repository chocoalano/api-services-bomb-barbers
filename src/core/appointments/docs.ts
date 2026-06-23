import { t } from 'elysia';

export const appointmentDocs = {
  // --- Customer Docs ---
  customerCreateAppointment: {
    body: t.Object({
      branch_id: t.String(),
      barber_id: t.Optional(t.String()),
      service_ids: t.Array(t.String({ minLength: 1 })),
      scheduled_at: t.Optional(t.String()),
      media_urls: t.Optional(t.Array(t.String({
        format: 'uri',
        description: 'URL gambar hasil upload dari endpoint POST /api/v1/media/upload. Gunakan field ini untuk menyertakan foto detail wajah atau referensi gaya rambut pada pemesanan.'
      }))),
      fulfillment_type: t.Optional(t.String()),
      service_address: t.Optional(t.String()),
      destination_latitude: t.Optional(t.Numeric()),
      destination_longitude: t.Optional(t.Numeric()),
      location_notes: t.Optional(t.String())
    }),
    detail: { tags: ['Customer Appointments'], summary: 'Booking Online', description: 'Membuat booking online. Jika pelanggan sudah mengunggah foto referensi melalui endpoint media upload, kirim URL gambar tersebut pada field media_urls agar referensi tersimpan bersama appointment.' }
  },
  customerGetAppointments: {
    query: t.Object({
      status: t.Optional(t.String({
        description: 'Filter status appointment. Dapat diisi satu status atau beberapa status dipisahkan koma. Nilai yang didukung: pending, confirmed, in_queue, in_service, completed, cancelled, no_show. Untuk kebutuhan UI Ongoing Orders, frontend juga dapat mengirim alias waiting dan in_process, misalnya status=waiting,in_process.'
      })),
      ongoing_only: t.Optional(t.BooleanString({
        description: 'Jika true, backend hanya mengembalikan pesanan yang masih berjalan, yaitu pending, confirmed, in_queue, dan in_service. Parameter ini cocok untuk halaman Ongoing Orders agar aplikasi tidak perlu mengambil seluruh riwayat pelanggan.'
      })),
      limit: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 100,
        description: 'Jumlah maksimal appointment yang dikembalikan dalam satu response. Default backend adalah 10 dan batas maksimal adalah 100.'
      })),
      page: t.Optional(t.Numeric({
        minimum: 1,
        description: 'Nomor halaman untuk pagination berbasis page. Default backend adalah 1.'
      })),
      before: t.Optional(t.String({
        description: 'Timestamp ISO opsional untuk pagination mundur berbasis cursor. Kirim created_at terakhir dari halaman sebelumnya jika frontend ingin mengambil data yang lebih lama.'
      }))
    }),
    detail: { tags: ['Customer Appointments'], summary: 'List Appointments', description: 'Melihat daftar appointment milik pelanggan yang sedang login. Endpoint ini mendukung filter status, ongoing_only, limit, page, dan before agar halaman riwayat maupun Ongoing Orders tidak perlu menarik seluruh data. Response sudah menyertakan relasi branch, barber, services, items untuk billing details, total harga, total durasi, dan koordinat awal tracking dari cabang. Field services berisi nama layanan, harga snapshot, durasi, dan image_url; field items disiapkan untuk struk pembayaran dan halaman tracking.' }
  },
  customerGetAppointmentDetail: {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Customer Appointments'], summary: 'Detail Appointment', description: 'Melihat detail satu pemesanan milik pelanggan. Response memakai struktur lengkap yang sama dengan list appointment: branch, barber, services, items, total harga, total durasi, customer_media_urls, dan koordinat awal tracking.' }
  },
  customerCancelAppointment: {
    params: t.Object({ id: t.String() }),
    body: t.Object({ reason: t.String() }),
    detail: { tags: ['Customer Appointments'], summary: 'Cancel Appointment', description: 'Membatalkan pemesanan oleh customer.' }
  },
  customerUpdateStatus: {
    params: t.Object({ id: t.String() }),
    body: t.Object({ status: t.String(), cancellation_reason: t.Optional(t.String()) }),
    detail: { tags: ['Customer Appointments'], summary: 'Update Status (Customer)', description: 'Memperbarui status pemesanan oleh customer (misal konfirmasi kedatangan barber). Backend akan memvalidasi kepemilikan pemesanan.' }
  },

  // --- Admin Docs ---
  adminCreateWalkIn: {
    params: t.Object({ branchId: t.String() }),
    body: t.Object({
      barber_id: t.Optional(t.String()),
      customer_id: t.Optional(t.String()),
      service_ids: t.Array(t.String({ minLength: 1 }))
    }),
    detail: { tags: ['Admin Appointments'], summary: 'Create Walk-in POS', description: 'Mencatat pelanggan walk-in di tempat.' }
  },
  adminGetQueue: {
    params: t.Object({ branchId: t.String() }),
    detail: { tags: ['Admin Appointments'], summary: 'Branch Queue', description: 'Melihat seluruh antrean aktif di cabang.' }
  },
  adminUpdateStatus: {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      status: t.String(),
      cancellation_reason: t.Optional(t.String())
    }),
    detail: { tags: ['Admin Appointments'], summary: 'Update Status', description: 'Mengubah status secara manual oleh admin.' }
  },

  // --- Barber Docs ---
  barberGetQueue: {
    detail: { tags: ['Dashboard Barber'], summary: 'Antrean dan Order Berjalan Barber', description: 'Mengambil daftar tugas milik barber yang sedang login. Response berupa array order siap pakai untuk halaman Dashboard Barber: id appointment, customer_name, service_name hasil gabungan layanan, price dari snapshot harga appointment_services, distance dan eta dari cache Redis bila tersedia, time dalam format jam Indonesia, address tujuan atau fallback alamat cabang, status frontend seperti pending, accepted, atau in_progress, serta raw_status untuk status asli dari database.' }
  },
  barberAcceptOrder: {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Barber Appointments'], summary: 'Accept Order', description: 'Barber menerima order dengan status pending. Status di database akan berubah menjadi confirmed yang pada frontend ditampilkan sebagai accepted. Endpoint ini hanya bisa dipanggil oleh barber yang menjadi pemilik appointment tersebut.' }
  },
  barberPushLocation: {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      lat: t.Numeric({ description: 'Latitude posisi barber saat ini.' }),
      lng: t.Numeric({ description: 'Longitude posisi barber saat ini.' }),
      eta_minutes: t.Optional(t.Numeric({ minimum: 0, description: 'Estimasi waktu tiba dalam menit (opsional).' }))
    }),
    detail: { tags: ['Barber Appointments'], summary: 'Push GPS Location', description: 'Barber mengirimkan koordinat GPS posisi real-time ke server. Data disimpan di Redis dan langsung dapat dibaca oleh customer melalui GET /api/v1/customer/appointments/{id}/tracking/eta. Harus dipanggil secara berkala saat barber sedang menuju lokasi pelanggan.' }
  },
  barberArriveAtLocation: {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Barber Appointments'], summary: 'Arrive at Location', description: 'Barber menandai bahwa ia sudah tiba di lokasi pelanggan. Status appointment berubah dari confirmed menjadi in_queue. Cache GPS di Redis dibersihkan karena tracking perjalanan sudah selesai.' }
  },
  barberStartService: {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Barber Appointments'], summary: 'Start Service', description: 'Memulai pelayanan (in_service).' }
  },
  barberCompleteService: {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({
      before_media_url: t.Optional(t.String({ format: 'uri', description: 'URL foto kondisi rambut sebelum dipotong, hasil upload dari POST /api/v1/media/upload.' })),
      after_media_url: t.Optional(t.String({ format: 'uri', description: 'URL foto hasil potong rambut setelah selesai, hasil upload dari POST /api/v1/media/upload.' }))
    })),
    detail: { tags: ['Barber Appointments'], summary: 'Complete Service', description: 'Menyelesaikan pelayanan (completed). Opsional: kirim before_media_url dan after_media_url dari hasil upload foto ke endpoint media untuk menyimpan dokumentasi foto layanan bersama data appointment.' }
  }
};
