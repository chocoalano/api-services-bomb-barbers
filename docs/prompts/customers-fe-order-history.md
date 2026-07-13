# Prompt untuk project `customers_fe` — Integrasi "History Orders" (Riwayat Pesanan)

Salin blok di bawah ini sebagai instruksi ke agen/pengembang di project `customers_fe`.
Kontrak API di bawah diambil langsung dari backend `api-services` (Bun + ElysiaJS)
dan **akurat per commit saat ini**. Semua nominal uang adalah BIGINT rupiah penuh
(bukan sen), dan semua timestamp adalah ISO 8601 **UTC** — tampilkan di zona
`Asia/Jakarta`.

---

## PROMPT (copy mulai dari sini)

Kamu bekerja di project **customers_fe** (aplikasi mobile/web pelanggan Bomb Barbershop).
Implementasikan halaman **Riwayat Pesanan (Order History)** yang mengambil data dari
backend REST API. Ikuti kontrak berikut **persis**; jangan menebak field atau path.

### 1. Konfigurasi & Autentikasi
- Base URL API dari env (mis. `VITE_API_BASE_URL`), contoh dev: `http://localhost:3000`.
  Semua endpoint diawali `/api/v1`.
- Setiap request WAJIB menyertakan header:
  `Authorization: Bearer <accessToken>`
- Jika token tidak ada/invalid → HTTP `401` dengan body `{ success:false, message, data:null }`.
  Tangani dengan refresh token / redirect ke login.

### 2. Endpoint yang dipakai
**Daftar pesanan (list) — dipakai untuk Riwayat & Pesanan Berjalan:**
```
GET /api/v1/customers/appointments
```
> Gunakan path **plural** `customers` (canonical). Path singular
> `/api/v1/customer/appointments` masih ada tapi **deprecated** (mengirim header
> peringatan) — jangan dipakai untuk kode baru.

**Detail satu pesanan:**
```
GET /api/v1/customers/appointments/:id
```

### 3. Query params (list)
| Param | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `status` | string (CSV) | — | Filter status, boleh beberapa dipisah koma. Nilai valid: `pending, confirmed, in_queue, in_service, completed, cancelled, no_show`. Alias UI: `waiting` (=pending,confirmed,in_queue), `in_process` (=in_service), `ongoing` (=semua status aktif). Status tak dikenal → HTTP 400. |
| `ongoing_only` | boolean string | `false` | Bila `true`, hanya pesanan berjalan (`pending, confirmed, in_queue, in_service`). Meng-override `status`. |
| `limit` | number | `10` | 1–100. Di luar rentang < 1 → 400; > 100 dipangkas ke 100. |
| `page` | number | `1` | Pagination berbasis page (offset = (page-1)*limit). |
| `before` | ISO datetime | — | Cursor mundur: hanya ambil `created_at` < nilai ini. |

**Aturan pemakaian di UI:**
- **Tab "Riwayat" (History)** → pesanan yang sudah selesai/berakhir. Kirim:
  `?status=completed,cancelled,no_show&limit=20&page=1`
  (Tidak ada alias `history`; sebutkan ketiga status ini eksplisit.)
- **Tab "Pesanan Berjalan" (Ongoing)** → `?ongoing_only=true`
  (atau `?status=waiting,in_process`).

### 4. Bentuk Response (envelope standar)
Semua response memakai envelope:
```ts
interface ApiEnvelope<T> {
  success: boolean;
  code: string | null;     // kode error bila ada (mis. 'INVALID_SLOT'); null saat sukses
  message: string;
  data: T;
  errors: unknown | null;  // detail validasi bila success=false
  meta: unknown | null;    // list order TIDAK mengembalikan meta pagination (null/absent)
}
```
> **Penting:** endpoint list mengembalikan **array langsung** di `data`, TANPA meta
> pagination. Untuk tahu apakah masih ada halaman berikutnya, cek
> `data.length === limit` lalu minta `page+1`. Urutan sudah dari backend:
> `scheduled_at` DESC (yang NULL di akhir), lalu `created_at` DESC.

### 5. Tipe data item pesanan (`data[]` pada list & `data` pada detail)
Bentuk item **identik** antara list dan detail. Gunakan interface ini:
```ts
interface CustomerOrder {
  id: string;
  branch_id: string;
  barber_id: string | null;
  customer_id: string;
  source: 'online_booking' | 'walk_in';

  // Status kanonik dari DB:
  status: 'pending' | 'confirmed' | 'in_queue' | 'in_service'
        | 'completed' | 'cancelled' | 'no_show';
  // Status ringkas untuk UI ongoing: 'waiting' | 'in_process' | <status apa adanya>
  ongoing_status: string;

  scheduled_at: string | null;        // ISO UTC
  scheduled_end_at: string | null;
  travel_buffer_min: number;
  queue_position: number | null;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancellation_reason: string | null;

  customer_media_urls: string[];      // foto referensi yang diunggah customer
  fulfillment_type: 'in_store' | 'home_service';
  service_address: string | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  destination_location: { lat: number; lng: number } | null;
  location_notes: string | null;
  journey_status: string;             // 'not_started' | 'en_route' | 'arrived' | ...
  version: number;

  // Nominal (BIGINT rupiah penuh):
  total_service_amount: number;       // subtotal layanan
  total_price: number;                // = subtotal layanan (kompat lama)
  grand_total: number;                // total ditagihkan (subtotal + fee + ongkir − diskon)
  service_fee: number;
  delivery_fee: number;
  discount_amount: number;
  product_amount: number;
  tip_amount: number;
  payment_method: string | null;      // 'qris' | 'card' | 'bank_transfer' | 'ewallet' | 'cash' | ...
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | string;

  // Rating/ulasan customer untuk order ini (null bila belum diulas):
  review: { rating: number | null; comment: string | null } | null;
  rating: number | null;

  total_duration_min: number;
  created_at: string;                 // ISO UTC
  updated_at: string;

  branch: {
    id: string; name: string; address: string | null;
    latitude: number | null; longitude: number | null;
    location: { lat: number; lng: number } | null;
  } | null;

  barber: {
    id: string; full_name: string; display_name: string;
    rating_avg: number | null; rating_count: number | null;
    latitude: number | null; longitude: number | null;
    location: { lat: number; lng: number } | null;
  } | null;

  // Alias lokasi awal tracking (dari koordinat cabang):
  location: { lat: number; lng: number } | null;
  tracking_initial_location: { lat: number; lng: number } | null;
  barber_lat: number | null;
  barber_lng: number | null;

  // Rincian layanan (dua bentuk untuk kompatibilitas — pakai `items` untuk struk):
  services: Array<{
    id: string; name: string | null; description: string | null;
    image_url: string | null; price: number; price_amount: number; duration_min: number;
  }>;
  items: Array<{
    id: string; item_type: 'service'; service_id: string;
    name: string | null; description: string | null; image_url: string | null;
    quantity: number; unit_price: number; price: number; total_price: number;
    duration_min: number;
  }>;
  appointment_services: unknown[];    // baris mentah appointment_services (jarang dipakai FE)
}
```

### 6. Aturan tampilan
- **Uang:** `grand_total` adalah nominal yang benar-benar dibayar customer. Untuk
  ringkasan riwayat tampilkan `grand_total`; untuk rincian struk pakai `items` +
  `service_fee`/`delivery_fee`/`discount_amount`. Format sebagai Rupiah penuh
  (mis. `Rp 50.000`), JANGAN bagi 100.
- **Waktu:** semua ISO UTC → render di `Asia/Jakarta` (WIB).
- **Badge status riwayat:** `completed` = Selesai, `cancelled` = Dibatalkan,
  `no_show` = Tidak Hadir. Untuk yang `cancelled`, tampilkan `cancellation_reason`
  bila ada.
- **Rating:** bila `review` null pada order `completed`, tampilkan CTA "Beri Ulasan";
  bila ada, tampilkan `review.rating` (bintang) + `review.comment`.
- **Home service vs in-store:** cek `fulfillment_type`. Untuk `home_service`,
  tampilkan `service_address` + `location_notes`.

### 7. Contoh pemanggilan
```ts
async function fetchOrderHistory(page = 1, limit = 20) {
  const res = await fetch(
    `${BASE_URL}/api/v1/customers/appointments?status=completed,cancelled,no_show&page=${page}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const body = await res.json() as ApiEnvelope<CustomerOrder[]>;
  if (!res.ok || !body.success) throw new Error(body.message);
  const orders = body.data;
  const hasMore = orders.length === limit;   // tidak ada meta pagination
  return { orders, hasMore };
}

async function fetchOrderDetail(id: string) {
  const res = await fetch(`${BASE_URL}/api/v1/customers/appointments/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await res.json() as ApiEnvelope<CustomerOrder>;
  if (!res.ok || !body.success) throw new Error(body.message);   // 404 bila bukan milik customer
  return body.data;
}
```

### 8. Penanganan error
- `400`: parameter tidak valid (mis. `status` tak dikenal, `limit`/`page` < 1).
  Pesan ada di `body.message`; tampilkan & perbaiki query.
- `401`: token tidak valid/kedaluwarsa → refresh/redirect login.
- `404` (detail): order tidak ditemukan atau bukan milik customer yang login.
- Selalu cek `body.success` selain HTTP status; jangan asumsikan `data` non-null saat error.

Buat layer API terpisah (mis. `services/orders.ts`) dengan tipe di atas, komponen
list dengan infinite scroll/pagination berbasis `page`, dan komponen detail. Jangan
membuat endpoint atau field baru yang tidak ada di kontrak ini.

## (akhir prompt)
