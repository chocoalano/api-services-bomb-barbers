# Bomb Barbershop — Customers API Map

Dokumen ini memetakan seluruh API customer yang aktif pada runtime per
22 Juni 2026. Integrasi frontend baru wajib memakai namespace canonical
`/api/v1/customers/*`.

Swagger interaktif tersedia di:

```text
GET /docs
```

## 1. Konfigurasi frontend

```env
REST_API_URL=http://localhost:3000
SOCKET_URL=http://localhost:3001
```

Production harus mengambil kedua URL tersebut dari environment frontend.
Jangan hard-code hostname atau port.

Header untuk endpoint terproteksi:

```http
Authorization: Bearer <customer_access_token>
Content-Type: application/json
```

Booking wajib menggunakan header idempotency:

```http
Idempotency-Key: <nilai-unik-8-sampai-128-karakter>
```

Gunakan key yang sama ketika retry request booking yang sama. Jangan memakai
key yang sama untuk payload booking berbeda.

## 2. Format response standar

Response sukses:

```json
{
  "success": true,
  "message": "Permintaan berhasil diproses",
  "data": {},
  "errors": null,
  "meta": null
}
```

Response gagal:

```json
{
  "success": false,
  "message": "Validasi gagal",
  "data": null,
  "errors": [
    {
      "field": "body.phone",
      "message": "Nomor telepon tidak valid"
    }
  ],
  "meta": null
}
```

Aturan frontend:

- Gunakan `success`, bukan hanya HTTP status, untuk menentukan hasil request.
- Tampilkan `message` sebagai pesan utama.
- Gunakan `errors` untuk validasi per-field.
- HTTP `401` berarti token/session tidak valid dan user harus login ulang jika
  refresh juga gagal.
- HTTP `409` berarti konflik idempotency, double payment, review ganda, atau
  slot booking sudah terisi.
- Semua waktu menggunakan ISO 8601/timestamptz. Tampilkan dalam zona
  `Asia/Jakarta`.
- Semua nominal adalah rupiah penuh tanpa desimal.

## 3. Ringkasan seluruh route canonical

Terdapat 38 kombinasi method/path canonical unik. Seluruh route pada tabel ini
aktif pada runtime.

| Domain | Method | Endpoint | Auth | Fungsi |
|---|---|---|---|---|
| Auth | POST | `/api/v1/customers/auth/register` | Publik | Registrasi customer |
| Auth | POST | `/api/v1/customers/auth/login` | Publik | Login customer |
| Auth | POST | `/api/v1/customers/auth/refresh` | Refresh token | Rotasi token |
| Auth | POST | `/api/v1/customers/auth/logout` | Refresh token | Cabut session |
| Profile | GET | `/api/v1/customers/me` | Bearer | Ambil profil |
| Profile | PATCH | `/api/v1/customers/me` | Bearer | Ubah nama/telepon |
| Catalog | GET | `/api/v1/customers/catalog/branches` | Publik | Daftar cabang |
| Catalog | GET | `/api/v1/customers/catalog/branches/:id` | Publik | Detail cabang |
| Catalog | GET | `/api/v1/customers/catalog/branches/:id/barbers` | Publik | Barber cabang |
| Catalog | GET | `/api/v1/customers/catalog/branches/:id/services` | Publik | Layanan dan harga |
| Catalog | GET | `/api/v1/customers/catalog/branches/:id/services/:serviceId/price` | Publik | Harga efektif |
| Availability | GET | `/api/v1/customers/catalog/branches/:id/available-slots` | Publik | Slot booking |
| Appointment | POST | `/api/v1/customers/appointments` | Bearer + idempotency | Buat booking |
| Appointment | GET | `/api/v1/customers/appointments` | Bearer | Daftar booking |
| Appointment | GET | `/api/v1/customers/appointments/:id` | Bearer | Detail booking |
| Appointment | POST | `/api/v1/customers/appointments/:id/cancel` | Bearer | Batalkan booking |
| Appointment | PATCH | `/api/v1/customers/appointments/:id/status` | Bearer | Alias cancel |
| Appointment | PATCH | `/api/v1/customers/appointments/:id/destination` | Bearer | Perbarui lokasi tujuan |
| Tracking | POST | `/api/v1/customers/appointments/:id/tracking/start` | Bearer | Consent tracking |
| Tracking | GET | `/api/v1/customers/appointments/:id/tracking/eta` | Bearer | Snapshot ETA |
| Tracking | PATCH | `/api/v1/customers/appointments/:id/tracking/location` | Bearer | Kirim GPS customer |
| Tracking | PATCH | `/api/v1/customers/appointments/:id/tracking/eta` | Bearer | Alias legacy GPS |
| Tracking | POST | `/api/v1/customers/appointments/:id/tracking/revoke` | Bearer | Cabut consent |
| Tracking | POST | `/api/v1/customers/appointments/:id/check-in` | Bearer | Check-in customer |
| Chat | GET | `/api/v1/customers/appointments/:id/chat` | Bearer | Riwayat chat |
| Chat | POST | `/api/v1/customers/appointments/:id/chat` | Bearer | Kirim chat |
| Payment | GET | `/api/v1/customers/payments/:id` | Bearer | Detail payment |
| Payment | GET | `/api/v1/customers/appointments/:id/payment` | Bearer | Payment appointment |
| Payment | POST | `/api/v1/customers/appointments/:id/payments` | Bearer | Inisiasi payment |
| Invoice | GET | `/api/v1/customers/invoices/:invoiceNumber` | Bearer | Nota milik customer |
| Review | POST | `/api/v1/customers/appointments/:id/reviews` | Bearer | Buat review |
| Content | GET | `/api/v1/customers/content/banners` | Publik | Banner aktif |
| Content | GET | `/api/v1/customers/content/gallery` | Publik | Galeri portfolio |
| Notification | GET | `/api/v1/customers/notifications` | Bearer | Notification center |
| Notification | PATCH | `/api/v1/customers/notifications/read-all` | Bearer | Baca semua |
| Notification | PATCH | `/api/v1/customers/notifications/:id/read` | Bearer | Baca satu |
| Media | POST | `/api/v1/customers/media/upload` | Bearer | Upload foto private |
| Media | GET | `/api/v1/customers/media/:id/url` | Bearer | Refresh signed URL |
| Media | DELETE | `/api/v1/customers/media/:id` | Bearer | Hapus media |

## 4. Autentikasi dan profil

### Registrasi

```http
POST /api/v1/customers/auth/register
```

```json
{
  "full_name": "Budi Santoso",
  "email": "budi@example.com",
  "phone": "081234567890",
  "password": "BombBarber#2026"
}
```

Wajib: `full_name`, `phone`, `password`. Email opsional. Password minimal
8 karakter. Sukses menggunakan status `201`. Error utama adalah `400` untuk
validasi dan `409` untuk email/telepon yang sudah digunakan.

### Login

```http
POST /api/v1/customers/auth/login
```

Dengan phone:

```json
{
  "phone": "081234567890",
  "password": "BombBarber#2026"
}
```

Dengan email:

```json
{
  "email": "budi@example.com",
  "phone": "",
  "password": "BombBarber#2026"
}
```

Response data:

```json
{
  "accessToken": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>"
}
```

Error: `401` kredensial salah, `403` akun tidak aktif, `429` rate limit.

### Refresh dan logout

```http
POST /api/v1/customers/auth/refresh
POST /api/v1/customers/auth/logout
```

Body keduanya:

```json
{
  "refreshToken": "<refresh-token>"
}
```

Refresh menerapkan token rotation. Setelah refresh berhasil, frontend harus
mengganti access dan refresh token secara atomik. Logout mencabut session
server-side dan frontend tetap harus menghapus token lokal.

### Profil

```http
GET /api/v1/customers/me
PATCH /api/v1/customers/me
```

Body PATCH:

```json
{
  "full_name": "Budi Santoso Updated",
  "phone": "081299999999"
}
```

Minimal kirim salah satu field. Email tidak dapat diubah melalui endpoint ini.

## 5. Katalog dan slot

### Cabang

```http
GET /api/v1/customers/catalog/branches
GET /api/v1/customers/catalog/branches/:id
```

Model utama:

```ts
type Branch = {
  id: string;
  region_id: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
};
```

Daftar cabang mengembalikan cabang yang belum soft-delete. Frontend tetap
disarankan memeriksa `is_active`.

### Barber cabang

```http
GET /api/v1/customers/catalog/branches/:id/barbers
```

`live_status` berasal dari Redis dan fallback ke `available`. Nilai utama UI:
`available`, `serving`, atau `offline`.

### Layanan dan harga

```http
GET /api/v1/customers/catalog/branches/:id/services
```

Query:

```text
limit=10&page=1&q=haircut
```

`search` tersedia sebagai alias `q`. Response item:

```json
{
  "id": "service-uuid",
  "name": "Premium Haircut",
  "description": "Potong rambut dan styling",
  "default_duration_min": 45,
  "price_amount": 85000,
  "image_url": "https://..."
}
```

Harga memakai prioritas branch, region, lalu global.

```http
GET /api/v1/customers/catalog/branches/:id/services/:serviceId/price
```

### Slot tersedia

```http
GET /api/v1/customers/catalog/branches/:id/available-slots
```

Contoh query:

```text
?date=2026-06-25
&service_ids=<service-uuid-1>
&service_ids=<service-uuid-2>
&barber_id=<barber-uuid>
&slot_interval_min=15
&fulfillment_type=home_service
&travel_buffer_min=15
```

| Field | Wajib | Keterangan |
|---|---|---|
| `date` | Ya | Format `YYYY-MM-DD`, WIB |
| `service_ids` | Ya | Query berulang atau array |
| `barber_id` | Tidak | Filter barber tertentu |
| `slot_interval_min` | Tidak | 5–120, default 30 |
| `fulfillment_type` | Tidak | `in_store` atau `home_service` |
| `travel_buffer_min` | Tidak | 0–120, hanya home service |

Response:

```json
{
  "branch_id": "uuid",
  "date": "2026-06-25",
  "timezone_offset": "+07:00",
  "duration_min": 75,
  "slot_interval_min": 15,
  "fulfillment_type": "home_service",
  "travel_buffer_min": 15,
  "slots": [
    {
      "start_at": "2026-06-25T03:00:00.000Z",
      "end_at": "2026-06-25T04:15:00.000Z",
      "label": "10.00 - 11.15",
      "available_barber_count": 1,
      "available_barber_ids": ["barber-uuid"]
    }
  ]
}
```

Slot hanya snapshot. Booking final tetap dapat menghasilkan `409` jika slot
diambil request lain.

## 6. Appointment

### Buat booking

```http
POST /api/v1/customers/appointments
Authorization: Bearer <token>
Idempotency-Key: booking-<uuid>
```

In-store:

```json
{
  "branch_id": "branch-uuid",
  "barber_id": "barber-uuid",
  "service_ids": ["service-uuid"],
  "scheduled_at": "2026-06-25T10:00:00+07:00",
  "fulfillment_type": "in_store"
}
```

Home service:

```json
{
  "branch_id": "branch-uuid",
  "barber_id": "barber-uuid",
  "service_ids": ["service-uuid-1", "service-uuid-2"],
  "scheduled_at": "2026-06-25T10:00:00+07:00",
  "fulfillment_type": "home_service",
  "service_address": "Jl. Wijaya I No. 10, Jakarta Selatan",
  "destination_latitude": -6.2442,
  "destination_longitude": 106.8096,
  "location_notes": "Rumah pagar hitam",
  "media_urls": ["<signed-media-url>"]
}
```

Home service mewajibkan barber, alamat, latitude, dan longitude. Backend
memvalidasi cabang, barber, harga, jam operasional, time-off, benturan jadwal,
travel buffer, queue position, snapshot layanan, dan idempotency dalam satu
transaksi.

Response `201` memuat `scheduled_end_at`, `travel_buffer_min`,
`queue_position`, dan status awal `pending`.

Error utama:

- `400`: payload/jadwal tidak valid;
- `404`: cabang, barber, layanan, atau harga tidak tersedia;
- `409`: slot overlap, time-off, atau idempotency key digunakan untuk request
  berbeda.

### Daftar appointment

```http
GET /api/v1/customers/appointments
```

| Query | Keterangan |
|---|---|
| `status` | Satu status atau CSV |
| `ongoing_only` | `true` untuk status aktif |
| `limit` | 1–100, default 10 |
| `page` | Default 1 |
| `before` | Cursor `created_at` ISO |

Status:

```text
pending, confirmed, in_queue, in_service, completed, cancelled, no_show
```

Alias filter:

```text
waiting    -> pending, confirmed, in_queue
in_process -> in_service
ongoing    -> pending, confirmed, in_queue, in_service
```

### Detail appointment

```http
GET /api/v1/customers/appointments/:id
```

```ts
type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "in_queue"
  | "in_service"
  | "completed"
  | "cancelled"
  | "no_show";

type Appointment = {
  id: string;
  branch_id: string;
  barber_id: string | null;
  customer_id: string;
  source: "online_booking" | "walk_in";
  status: AppointmentStatus;
  ongoing_status: "waiting" | "in_process" | null;
  scheduled_at: string;
  scheduled_end_at: string | null;
  travel_buffer_min: number;
  queue_position: number | null;
  fulfillment_type: "in_store" | "home_service";
  service_address: string | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  destination_location: { lat: number; lng: number } | null;
  location_notes: string | null;
  journey_status: string;
  customer_media_urls: string[];
  total_price: number;
  total_duration_min: number;
  services: unknown[];
  items: unknown[];
  branch: Branch | null;
  barber: unknown | null;
  created_at: string;
  updated_at: string;
};
```

### Pembatalan

Direkomendasikan:

```http
POST /api/v1/customers/appointments/:id/cancel
```

```json
{
  "reason": "Jadwal saya berubah"
}
```

Alias status:

```http
PATCH /api/v1/customers/appointments/:id/status
```

```json
{
  "status": "cancelled",
  "cancellation_reason": "Tidak dapat hadir"
}
```

Customer tidak dapat melakukan `pending -> confirmed`. Konfirmasi hanya oleh
barber/admin.

### Perbarui lokasi tujuan

```http
PATCH /api/v1/customers/appointments/:id/destination
```

```json
{
  "destination_latitude": -6.2277,
  "destination_longitude": 106.8099
}
```

Hanya berlaku untuk appointment `home_service` dengan status `pending`,
`confirmed`, atau `in_queue`. Setelah barber memulai pelayanan (`in_service`)
lokasi tidak lagi dapat diubah oleh customer.

Aturan validasi:

- Kedua koordinat wajib dikirim.
- Nilai `null`, `undefined`, atau persis `0.0` ditolak dengan pesan
  `"Titik potong/lokasi harus diisi"`.
- Latitude harus dalam rentang -90 s/d 90; longitude -180 s/d 180.

Error: `400` koordinat tidak valid atau status tidak memungkinkan, `403`
appointment bukan milik customer, `404` appointment tidak ditemukan.

## 7. Tracking, ETA, dan check-in

Frontend sebaiknya menjalankan live tracking hanya untuk home service dengan
status `confirmed` atau `in_queue`.

### Mulai tracking

```http
POST /api/v1/customers/appointments/:id/tracking/start
```

```json
{
  "consent": true
}
```

### Kirim lokasi customer

```http
PATCH /api/v1/customers/appointments/:id/tracking/location
```

```json
{
  "lat": -6.2442,
  "lng": 106.8096,
  "accuracy_m": 12,
  "heading": 180,
  "speed_mps": 1.2,
  "captured_at": "2026-06-25T02:30:00.000Z"
}
```

Aturan:

- `captured_at` harus lebih baru dari lokasi sebelumnya;
- default maksimal umur data 120 detik;
- default maksimal akurasi GPS 100 meter;
- perpindahan tidak boleh menghasilkan kecepatan tidak realistis;
- sesi tracking harus aktif;
- endpoint terkena rate limit.

Jangan gunakan endpoint legacy berikut untuk integrasi baru:

```http
PATCH /api/v1/customers/appointments/:id/tracking/eta
```

Endpoint tersebut hanya alias update lokasi dan `eta_minutes` dari customer
diabaikan.

### Ambil ETA

```http
GET /api/v1/customers/appointments/:id/tracking/eta
```

Gunakan `is_live` dan `source`:

```text
source=redis           -> lokasi barber live
source=branch_fallback -> lokasi cabang sebagai placeholder
source=none            -> lokasi belum tersedia
```

### Cabut consent

```http
POST /api/v1/customers/appointments/:id/tracking/revoke
```

Response data:

```json
{
  "revoked": true
}
```

### Check-in

```http
POST /api/v1/customers/appointments/:id/check-in
```

GPS:

```json
{
  "method": "gps",
  "lat": -6.2308,
  "lng": 106.8021
}
```

QR:

```json
{
  "method": "qr_code"
}
```

Metode customer valid: `qr`, `qr_code`, `gps`, `geofence`. `manual` ditolak.
Check-in GPS harus berada dalam geofence cabang dan hanya dapat dilakukan satu
kali.

## 8. Chat

```http
GET  /api/v1/customers/appointments/:id/chat?page=1&limit=20
POST /api/v1/customers/appointments/:id/chat
```

```json
{
  "text": "Saya sudah berada di lokasi."
}
```

`message` masih diterima sebagai alias, tetapi frontend baru harus memakai
`text`.

## 9. Pembayaran dan invoice

### Inisiasi pembayaran

```http
POST /api/v1/customers/appointments/:id/payments
```

```json
{
  "method": "qris",
  "provider": "midtrans",
  "tip_amount": 20000
}
```

Provider yang tersedia: `midtrans` dan `xendit`. Backend menghitung ulang total
dari snapshot layanan. Gunakan `payment_url`, `redirect_url`, atau `token` dari
response gateway.

### Status berdasarkan appointment

```http
GET /api/v1/customers/appointments/:id/payment
```

`404` berarti appointment belum mempunyai payment.

### Detail payment

```http
GET /api/v1/customers/payments/:id
```

### Invoice customer

```http
GET /api/v1/customers/invoices/:invoiceNumber
```

Gunakan access token. Untuk public share link, gunakan sementara:

```http
GET /api/v1/invoices/:invoiceNumber?token=<invoice_access_token>
```

Lihat gap invoice pada bagian akhir.

## 10. Review

```http
POST /api/v1/customers/appointments/:id/reviews
```

```json
{
  "rating": 5,
  "comment": "Hasil potongannya rapi.",
  "photo_url": "<signed-media-url>",
  "tip_amount": 20000
}
```

Appointment harus `completed`, milik customer, memiliki barber, dan belum
pernah di-review. `tip_amount` tidak melakukan mutasi finansial; tip harus tetap
dikirim saat membuat payment.

## 11. Konten dan notifikasi

```http
GET /api/v1/customers/content/banners?limit=10
GET /api/v1/customers/content/gallery?limit=30&barber_id=<uuid>&branch_id=<uuid>
```

Keduanya publik.

Notification center:

```http
GET /api/v1/customers/notifications?limit=20&unread_only=true&before=<ISO>
PATCH /api/v1/customers/notifications/:id/read
PATCH /api/v1/customers/notifications/read-all
```

Response daftar notifikasi berbentuk:

```json
{
  "items": [
    {
      "id": "notification-uuid",
      "title": "Booking dikonfirmasi",
      "body": "Appointment telah dikonfirmasi.",
      "type": "appointment_confirmed",
      "read_at": null,
      "is_read": false
    }
  ],
  "unread_count": 3
}
```

## 12. Media private

Upload:

```http
POST /api/v1/customers/media/upload
Content-Type: multipart/form-data
```

Form:

```text
file=<binary JPG|PNG|WEBP>
purpose=hair_style_reference
```

Purpose: `face_reference`, `hair_style_reference`,
`appointment_reference`, atau `general`. Maksimum 5 MB.

Response utama:

```json
{
  "asset_id": "asset-uuid",
  "visibility": "private",
  "signed_url": "https://...",
  "public_url": "https://...",
  "expires_in": 3600,
  "content_type": "image/webp",
  "width": 1080,
  "height": 1350
}
```

`public_url` adalah alias signed URL, bukan URL publik permanen.

```http
GET    /api/v1/customers/media/:id/url
DELETE /api/v1/customers/media/:id
```

Simpan `asset_id` untuk meminta signed URL baru saat URL lama kedaluwarsa.

## 13. Socket.IO customer

```ts
import { io } from "socket.io-client";

const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  auth: { token: accessToken }
});
```

Untuk menerima event appointment:

```ts
socket.emit("join_appointment", appointmentId, (ack) => {
  if (!ack.success) console.error(ack.error);
});
```

Command:

| Event | Payload |
|---|---|
| `join_appointment` | `appointmentId` |
| `leave_appointment` | `appointmentId` |
| `push_customer_location` | `{ appointment_id, lat, lng, ... }` |

Event:

| Event | Fungsi |
|---|---|
| `appointment:status_changed` | Status appointment |
| `appointment:barber_location` | Lokasi barber dan ETA |
| `appointment:customer_location` | Update lokasi customer |
| `appointment:chat_message` | Chat baru |
| `auth:expired` | Token socket kedaluwarsa |

Semua command harus memakai acknowledgement callback.

## 14. Mapping halaman frontend

| Halaman/fitur | Endpoint |
|---|---|
| Register/Login | customer auth |
| Home | banners, branches, gallery |
| Branch detail | branch, barbers, services |
| Pilih jadwal | available-slots |
| Konfirmasi booking | media upload lalu create appointment |
| Ongoing orders | appointments `?ongoing_only=true` |
| Order detail | appointment detail |
| Live pickup | tracking REST + Socket.IO |
| Chat | chat REST + socket event |
| Check-in | appointment check-in |
| Payment | create payment lalu poll payment |
| Receipt | protected invoice |
| Review | reviews setelah completed |
| Notification center | notifications GET/read |
| Profile | GET/PATCH `/customers/me` |

## 15. API client TypeScript

```ts
type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T | null;
  errors: unknown;
  meta: unknown;
};

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string
): Promise<T> {
  const response = await fetch(`${REST_API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers
    }
  });

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.success) {
    throw {
      status: response.status,
      message: payload.message,
      errors: payload.errors
    };
  }
  return payload.data as T;
}
```

Booking:

```ts
const appointment = await apiRequest<Appointment>(
  "/api/v1/customers/appointments",
  {
    method: "POST",
    headers: {
      "Idempotency-Key": `booking-${crypto.randomUUID()}`
    },
    body: JSON.stringify(bookingPayload)
  },
  accessToken
);
```

## 16. Route deprecated

Alias deprecated mengirim:

```http
Deprecation: true
Sunset: Sat, 01 Jan 2028 00:00:00 GMT
Link: </api/v1/customers/...>; rel="canonical"
```

| Deprecated | Canonical |
|---|---|
| `/api/v1/customer/auth/*` | `/api/v1/customers/auth/*` |
| `/api/v1/customer/me` | `/api/v1/customers/me` |
| `/api/v1/customer/appointments/*` | `/api/v1/customers/appointments/*` |
| `/api/v1/branches*` | `/api/v1/customers/catalog/branches*` |
| `/api/v1/banners` | `/api/v1/customers/content/banners` |
| `/api/v1/gallery` | `/api/v1/customers/content/gallery` |
| `/api/v1/notifications` | `/api/v1/customers/notifications` |
| `/api/v1/customer/notifications` | `/api/v1/customers/notifications` |
| `/api/v1/customer/media/*` | `/api/v1/customers/media/*` |
| `/api/v1/media/upload` | `/api/v1/customers/media/upload` |
| `/api/v1/customer/payments/*` | `/api/v1/customers/payments/*` |
| `/api/v1/customer/invoices/*` | `/api/v1/customers/invoices/*` |
| `/api/v1/customer/appointments/:id/payment` | `/api/v1/customers/appointments/:id/payments` |
| `/api/v1/customer/appointments/:id/review` | `/api/v1/customers/appointments/:id/reviews` |
| `/api/v1/customer/appointments/:id/tracking/*` | canonical customers equivalent |
| `/api/v1/customer/appointments/:id/check-in` | canonical customers equivalent |

## 17. Gap implementasi yang perlu diketahui frontend

1. `GET /api/v1/customers/invoices/:invoiceNumber` didaftarkan dua kali pada
   source sebagai public-token route dan protected route dengan method/path
   identik. Customer app harus menggunakan versi protected. Public share link
   sementara memakai `/api/v1/invoices/:invoiceNumber?token=...`.
2. PATCH profil, mutation notification, GET payment by appointment, dan revoke
   tracking aktif tetapi belum memiliki metadata Swagger lengkap. Kontraknya
   sudah dicatat pada dokumen ini.
3. Swagger check-in lama masih menampilkan contoh `manual`, tetapi service
   customer menolak metode manual.
4. `media_urls` pada booking/review menerima signed URL yang dapat kedaluwarsa.
   Frontend wajib menyimpan `asset_id` untuk meminta URL baru.
