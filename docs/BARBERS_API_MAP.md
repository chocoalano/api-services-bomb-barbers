# Bomb Barbershop — Barbers API Map

Dokumen ini memetakan seluruh API barber yang aktif pada runtime per
22 Juni 2026. Integrasi aplikasi mobile/frontend barber baru wajib memakai
namespace canonical `/api/v1/barbers/*`.

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

Header untuk endpoint terproteksi (setelah login):

```http
Authorization: Bearer <barber_access_token>
Content-Type: application/json
```

Upload multipart tidak boleh menyertakan `Content-Type` manual — biarkan
browser/SDK mengisi boundary secara otomatis.

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
      "field": "body.lat",
      "message": "Nilai lat harus angka"
    }
  ],
  "meta": null
}
```

Aturan frontend:

- Gunakan `success`, bukan hanya HTTP status, untuk menentukan hasil request.
- Tampilkan `message` sebagai pesan utama ke pengguna.
- Gunakan `errors` untuk validasi per-field jika ada.
- HTTP `401` berarti token kedaluwarsa — coba refresh, jika gagal tampilkan
  halaman login ulang.
- HTTP `403` berarti akun tidak punya profil barber atau tidak memiliki izin
  aksi tersebut.
- HTTP `409` berarti konflik jadwal barber (slot sudah terisi oleh appointment
  lain).
- Semua waktu menggunakan ISO 8601/timestamptz. Tampilkan dalam zona
  `Asia/Jakarta`.
- Semua nominal adalah rupiah penuh tanpa desimal.

## 3. Ringkasan seluruh route canonical

Terdapat 29 kombinasi method/path canonical unik pada namespace barber.

| Domain | Method | Endpoint | Auth | Fungsi |
|---|---|---|---|---|
| Auth | POST | `/api/v1/barbers/auth/login` | Publik | Login barber |
| Auth | POST | `/api/v1/barbers/auth/refresh` | Refresh token | Rotasi token |
| Auth | POST | `/api/v1/barbers/auth/logout` | Refresh token | Cabut session |
| Profil | GET | `/api/v1/barbers/me` | Bearer | Ambil profil barber |
| Kehadiran | PATCH | `/api/v1/barbers/me/status` | Bearer | Set status kehadiran |
| Antrean | GET | `/api/v1/barbers/queue` | Bearer | Antrean dan order aktif |
| Appointment | GET | `/api/v1/barbers/appointments/history` | Bearer | Riwayat appointment |
| Appointment | GET | `/api/v1/barbers/appointments/:id` | Bearer | Detail appointment |
| Appointment | PATCH | `/api/v1/barbers/appointments/:id/accept` | Bearer | Terima order |
| Appointment | POST | `/api/v1/barbers/appointments/:id/reject` | Bearer | Tolak order |
| Appointment | PATCH | `/api/v1/barbers/appointments/:id/no-show` | Bearer | Tandai no-show |
| Appointment | PATCH | `/api/v1/barbers/appointments/:id/arrive` | Bearer | Tandai tiba |
| Appointment | PATCH | `/api/v1/barbers/appointments/:id/start` | Bearer | Mulai pelayanan |
| Appointment | PATCH | `/api/v1/barbers/appointments/:id/complete` | Bearer | Selesaikan pelayanan |
| Tracking | GET | `/api/v1/barbers/appointments/:id/tracking` | Bearer | Snapshot tracking |
| Tracking | POST | `/api/v1/barbers/appointments/:id/tracking` | Bearer | Kirim lokasi GPS |
| Navigasi | GET | `/api/v1/barbers/appointments/:id/navigation` | Bearer | Data navigasi |
| Dashboard | GET | `/api/v1/barbers/dashboard/today` | Bearer | Dashboard hari ini |
| Dashboard | GET | `/api/v1/barbers/stats/daily` | Bearer | Statistik harian |
| Dashboard | GET | `/api/v1/barbers/earnings` | Bearer | Riwayat pendapatan |
| Komisi | GET | `/api/v1/barbers/commissions` | Bearer | Laporan komisi harian |
| Chat | GET | `/api/v1/barbers/appointments/:id/chat` | Bearer | Riwayat chat |
| Chat | POST | `/api/v1/barbers/appointments/:id/chat` | Bearer | Kirim pesan |
| Portfolio | POST | `/api/v1/barbers/portfolio` | Bearer | Upload portfolio |
| Portfolio | GET | `/api/v1/barbers/portfolio` | Bearer | Daftar portfolio saya |
| Portfolio | DELETE | `/api/v1/barbers/portfolio/:id` | Bearer | Hapus portfolio |
| Media | POST | `/api/v1/barbers/media/upload` | Bearer | Upload media private |
| Media | GET | `/api/v1/barbers/media/:id/url` | Bearer | Refresh signed URL |
| Media | DELETE | `/api/v1/barbers/media/:id` | Bearer | Hapus media |

## 4. Autentikasi dan profil

### Login

```http
POST /api/v1/barbers/auth/login
```

```json
{
  "email": "andi.barber@bombbarbershop.com",
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

JWT yang diterbitkan memuat role staff. Endpoint operasional barber kemudian
memverifikasi secara mandiri bahwa staff tersebut memiliki profil barber aktif.
Error utama: `400` validasi, `401` kredensial salah, `403` akun tidak aktif,
`429` rate limit.

### Refresh dan logout

```http
POST /api/v1/barbers/auth/refresh
POST /api/v1/barbers/auth/logout
```

Body keduanya:

```json
{
  "refreshToken": "<refresh-token>"
}
```

Refresh menerapkan token rotation. Setelah refresh berhasil, frontend harus
mengganti access dan refresh token secara atomik. Logout mencabut session
server-side; frontend tetap harus menghapus token lokal.

### Profil barber

```http
GET /api/v1/barbers/me
```

Response data mencakup data akun staff dan profil barber:

```ts
type BarberProfile = {
  id: string;               // staff_user_id
  email: string;
  full_name: string;
  phone: string | null;
  barber: {
    id: string;
    display_name: string;
    live_status: "available" | "serving" | "on_break" | "offline";
    bio: string | null;
    rating_avg: number;
    rating_count: number;
    branch_id: string;
  } | null;
};
```

`barber` bernilai `null` jika staff belum memiliki profil barber di cabang
manapun.

### Status kehadiran

```http
PATCH /api/v1/barbers/me/status
```

```json
{
  "status": "online"
}
```

Nilai valid: `online`, `offline`, `unavailable`. Status ini adalah kehadiran
tingkat aplikasi, terpisah dari `live_status` barber (yang dipakai antrean).
Admin dapat meng-override `live_status` secara terpisah melalui endpoint admin.

## 5. Antrean dan alur appointment

### Alur status appointment

```
pending
  ├── accept  → confirmed  (alias UI: "accepted")
  └── reject  → cancelled

confirmed
  ├── arrive  → in_queue   (alias UI: "arrived")
  └── no-show → no_show
  └── [home_service] kirim lokasi GPS →  (status tidak berubah)

in_queue
  ├── start   → in_service
  └── no-show → no_show

in_service
  └── complete → completed
```

Alias status hanya berlaku pada field `status` di response endpoint aksi.
Field `raw_status` selalu memuat nilai database yang sesungguhnya.

### Antrean aktif

```http
GET /api/v1/barbers/queue
```

Mengembalikan appointment berstatus `pending`, `confirmed`, `in_queue`, dan
`in_service` yang ditugaskan kepada barber pada token. Response sudah diformat
untuk keperluan dashboard:

```json
[
  {
    "id": "appointment-uuid",
    "customer_name": "Budi Santoso",
    "service_name": "Premium Haircut + Hair Wash",
    "price": 105000,
    "distance": "2.4 km",
    "eta": "18 menit",
    "time": "10:00",
    "address": "Jl. Senopati No. 88, Jakarta Selatan",
    "status": "accepted",
    "raw_status": "confirmed"
  }
]
```

`distance` dan `eta` berasal dari Redis (tracking aktif). Kosong jika tidak
ada sesi tracking.

### Riwayat appointment

```http
GET /api/v1/barbers/appointments/history
```

| Query | Keterangan |
|---|---|
| `page` | Default 1 |
| `limit` | 1–100, default 10 |

Mengembalikan appointment berstatus `completed`, `cancelled`, dan `no_show`
milik barber, diurutkan dari terbaru.

### Detail appointment

```http
GET /api/v1/barbers/appointments/:id
```

```ts
type AppointmentDetail = {
  id: string;
  branch_id: string;
  barber_id: string;
  customer_id: string;
  source: "online_booking" | "walk_in";
  status: string;
  raw_status: string;
  scheduled_at: string;
  scheduled_end_at: string | null;
  queue_position: number | null;
  started_at: string | null;
  completed_at: string | null;
  cancellation_reason: string | null;
  customer_media_urls: string[];
  created_at: string;
  updated_at: string;
};
```

### Terima order

```http
PATCH /api/v1/barbers/appointments/:id/accept
```

Appointment harus berstatus `pending`. Setelah sukses, status DB menjadi
`confirmed`; response alias mengembalikan `status: "accepted"`.

### Tolak order

```http
POST /api/v1/barbers/appointments/:id/reject
```

```json
{
  "reason": "Saya sedang dalam perjalanan ke appointment lain"
}
```

`reason` wajib diisi. Appointment harus berstatus `pending`. Status DB berubah
menjadi `cancelled`.

### Tandai no-show

```http
PATCH /api/v1/barbers/appointments/:id/no-show
```

Hanya tersedia untuk appointment berstatus `confirmed` atau `in_queue`. Status
DB berubah menjadi `no_show`.

### Tandai tiba

```http
PATCH /api/v1/barbers/appointments/:id/arrive
```

Appointment harus berstatus `confirmed`. Backend menghapus cache ETA dan
mengubah status DB menjadi `in_queue`; response alias mengembalikan
`status: "arrived"`.

### Mulai pelayanan

```http
PATCH /api/v1/barbers/appointments/:id/start
```

Status DB berubah menjadi `in_service`, `started_at` diisi, dan `live_status`
barber diperbarui menjadi `serving` di Redis.

### Selesaikan pelayanan

```http
PATCH /api/v1/barbers/appointments/:id/complete
```

Body opsional (seluruh body boleh tidak dikirim):

```json
{
  "before_media_url": "https://api.bombbarbershop.com/public/uploads/before.webp",
  "after_media_url": "https://api.bombbarbershop.com/public/uploads/after.webp"
}
```

Gunakan URL dari endpoint upload media barber. Backend menggabungkan URL ini
dengan `customer_media_urls` yang sudah ada. Status DB berubah menjadi
`completed`, `completed_at` diisi, sesi tracking dihapus, dan `live_status`
barber dikembalikan menjadi `available`.

## 6. Tracking dan navigasi

Tracking aktif hanya tersedia untuk appointment `home_service` berstatus
`confirmed` atau `in_queue`.

### Kirim lokasi GPS

```http
POST /api/v1/barbers/appointments/:id/tracking
```

```json
{
  "lat": -6.2297,
  "lng": 106.7998,
  "accuracy_m": 8,
  "heading": 180,
  "speed_mps": 8,
  "captured_at": "2026-06-25T02:30:00.000Z"
}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `lat` | Ya | Latitude -90 s/d 90 |
| `lng` | Ya | Longitude -180 s/d 180 |
| `accuracy_m` | Tidak | Akurasi GPS dalam meter |
| `heading` | Tidak | Arah pergerakan 0–359 derajat |
| `speed_mps` | Tidak | Kecepatan dalam meter per detik |
| `captured_at` | Tidak | Waktu GPS; maksimal 2 menit sebelum request |
| `eta_minutes` | Tidak | Legacy, diabaikan oleh server |

Server menyimpan koordinat di Redis, membaca lokasi customer terbaru,
menghitung jarak dan ETA (routing provider atau Haversine fallback), lalu
menyiarkan snapshot via Socket.IO ke semua participant.

Response:

```json
{
  "barber_location": {
    "appointment_id": "uuid",
    "actor_id": "barber-uuid",
    "actor_type": "barber",
    "lat": -6.2297,
    "lng": 106.7998,
    "accuracy_m": 8,
    "received_at": "2026-06-25T02:30:01.000Z",
    "sequence": 21
  },
  "customer_location": { "lat": -6.2442, "lng": 106.8096, "sequence": 14 },
  "route": {
    "source": "routing_provider",
    "distance_km": 2.4,
    "eta_minutes": 8,
    "calculated_at": "2026-06-25T02:30:01.000Z"
  }
}
```

`route.source` dapat bernilai `routing_provider` atau `haversine`.

### Snapshot tracking

```http
GET /api/v1/barbers/appointments/:id/tracking
```

Mengembalikan state tracking terkini dari Redis: posisi barber, posisi customer,
dan rute terakhir. Error `403` jika barber bukan participant appointment tersebut.

### Data navigasi

```http
GET /api/v1/barbers/appointments/:id/navigation
```

Mengembalikan data yang dibutuhkan aplikasi navigasi: alamat tujuan, koordinat
destination, catatan lokasi, URL referensi media customer, dan rute terakhir
dari Redis jika tersedia:

```json
{
  "destination": {
    "address": "Jl. Senopati No. 88, Jakarta Selatan",
    "latitude": -6.2442,
    "longitude": 106.8096,
    "notes": "Pagar hitam, masuk gang kecil"
  },
  "customer_media_urls": ["https://..."],
  "route": { "distance_km": 2.4, "eta_minutes": 8 },
  "customer_location": { "lat": -6.2442, "lng": 106.8096 }
}
```

Gunakan endpoint ini untuk menampilkan tombol "Buka di Maps" dan preview media
referensi customer.

## 7. Dashboard dan statistik

### Dashboard hari ini

```http
GET /api/v1/barbers/dashboard/today
```

Zona waktu `Asia/Jakarta`. `current_order` dipilih berdasarkan prioritas
`in_service` → `in_queue` → `confirmed` → `pending`, lalu posisi antrean dan
jadwal.

```json
{
  "pending_orders": 2,
  "active_orders": 1,
  "completed_today": 5,
  "rating": 4.85,
  "current_order": {
    "id": "appointment-uuid",
    "customer_name": "Budi Santoso",
    "service_name": "Premium Haircut",
    "price": 85000,
    "time": "10:00",
    "status": "accepted",
    "raw_status": "confirmed"
  },
  "total_appointments": 8,
  "total_completed": 5,
  "heads_count": 5,
  "commission_earned": 300000,
  "tips_earned": 50000,
  "total_earnings": 300000
}
```

### Statistik harian

```http
GET /api/v1/barbers/stats/daily
```

Mengembalikan riwayat `barber_daily_stats` milik barber, diurutkan dari tanggal
terbaru:

```json
[
  {
    "id": "stat-uuid",
    "barber_id": "barber-uuid",
    "branch_id": "branch-uuid",
    "summary_date": "2026-06-22",
    "heads_count": 5,
    "commission_earned": 300000,
    "created_at": "2026-06-22T16:00:00.000Z"
  }
]
```

### Riwayat pendapatan

```http
GET /api/v1/barbers/earnings
```

Alias semantis untuk `stats/daily`. Response identik: `summary_date`,
`heads_count`, `commission_earned`. Gunakan endpoint ini untuk halaman laporan
pendapatan.

## 8. Komisi

```http
GET /api/v1/barbers/commissions
```

Mengambil `barber_daily_stats` milik barber pada token. Identik dengan
`stats/daily` namun dimaksudkan sebagai titik akses laporan keuangan formal.
Response:

```json
[
  {
    "id": "stat-uuid",
    "barber_id": "barber-uuid",
    "branch_id": "branch-uuid",
    "summary_date": "2026-06-22",
    "heads_count": 5,
    "commission_earned": 300000
  }
]
```

Error `403` jika staff tidak memiliki profil barber.

## 9. Chat

```http
GET  /api/v1/barbers/appointments/:id/chat?page=1&limit=20
POST /api/v1/barbers/appointments/:id/chat
```

POST body:

```json
{
  "text": "Saya tiba sekitar 15 menit lagi."
}
```

Barber hanya dapat mengakses chat appointment yang ditugaskan kepadanya.
Pesan diurutkan dari terlama ke terbaru. Response item:

```json
{
  "id": "message-uuid",
  "appointment_id": "appointment-uuid",
  "sender_id": "staff-uuid",
  "sender_role": "barber",
  "text": "Saya tiba sekitar 15 menit lagi.",
  "created_at": "2026-06-25T02:30:00.000Z"
}
```

Kirim dan terima pesan real-time melalui Socket.IO event
`appointment:chat_message`.

## 10. Portfolio

Portfolio barber ditampilkan pada galeri customer
(`GET /api/v1/customers/content/gallery`).

### Upload portfolio

```http
POST /api/v1/barbers/portfolio
Content-Type: multipart/form-data
```

Form:

```text
file=<binary JPG|PNG|WEBP, maks 5 MB>
caption=Modern low fade dengan textured top
```

`caption` opsional, maksimal 300 karakter. Gambar dioptimasi menjadi WebP.
Sukses menggunakan status `201`:

```json
{
  "id": "portfolio-uuid",
  "barber_id": "barber-uuid",
  "image_url": "https://api.bombbarbershop.com/public/uploads/portfolio/barber-work.webp",
  "caption": "Modern low fade dengan textured top",
  "created_at": "2026-06-22T08:00:00.000Z"
}
```

### Daftar portfolio

```http
GET /api/v1/barbers/portfolio
```

Mengembalikan seluruh portfolio milik barber yang sedang login, diurutkan dari
terbaru. Barber tidak dapat membaca portfolio barber lain melalui endpoint ini.

### Hapus portfolio

```http
DELETE /api/v1/barbers/portfolio/:id
```

Menghapus item portfolio dan file dari storage. Error `403` jika portfolio
bukan milik barber yang sedang login.

## 11. Media private

Media barber disimpan di bucket private Supabase Storage. Gunakan endpoint ini
untuk mendokumentasikan sebelum/sesudah pelayanan, lalu kirimkan URL ke endpoint
`complete`.

### Upload media

```http
POST /api/v1/barbers/media/upload
Content-Type: multipart/form-data
```

Form:

```text
file=<binary JPG|PNG|WEBP, maks 5 MB>
purpose=appointment_reference
```

`purpose` opsional, nilai: `face_reference`, `hair_style_reference`,
`appointment_reference` (default), `general`.

Sukses menggunakan status `201`:

```json
{
  "asset_id": "asset-uuid",
  "bucket": "bomb-private-media",
  "path": "staff/<staff-uuid>/2026-06-22/appointment_reference-<uuid>.webp",
  "visibility": "private",
  "signed_url": "https://project.supabase.co/storage/v1/object/sign/...",
  "public_url": "https://project.supabase.co/storage/v1/object/sign/...",
  "expires_in": 3600,
  "content_type": "image/webp",
  "size": 184320,
  "width": 1080,
  "height": 1350
}
```

`public_url` adalah alias signed URL, bukan URL publik permanen. Simpan
`asset_id` untuk meminta signed URL baru.

### Refresh signed URL

```http
GET /api/v1/barbers/media/:id/url
```

Mengembalikan signed URL baru yang masih valid. Gunakan setiap kali `signed_url`
mendekati atau melewati `expires_in`.

### Hapus media

```http
DELETE /api/v1/barbers/media/:id
```

Menghapus record dan file dari storage. Error `403` jika media bukan milik
barber yang sedang login.

## 12. Socket.IO barber

```ts
import { io } from "socket.io-client";

const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  auth: { token: barberAccessToken }
});
```

Untuk bergabung ke room appointment:

```ts
socket.emit("join_appointment", appointmentId, (ack) => {
  if (!ack.success) console.error(ack.error);
});
```

Command:

| Event | Payload | Keterangan |
|---|---|---|
| `join_appointment` | `appointmentId` | Bergabung ke room appointment |
| `leave_appointment` | `appointmentId` | Keluar dari room |
| `push_barber_location` | `{ appointment_id, lat, lng, ... }` | Alias Socket.IO untuk kirim lokasi |

Event yang diterima:

| Event | Fungsi |
|---|---|
| `appointment:new_order` | Order baru masuk atau reassign dari admin |
| `appointment:status_changed` | Status appointment berubah |
| `appointment:barber_location` | Konfirmasi snapshot lokasi barber terkirim |
| `appointment:customer_location` | Update lokasi customer (home service) |
| `appointment:chat_message` | Pesan chat baru dari customer |
| `auth:expired` | Token socket kedaluwarsa; lakukan refresh dan reconnect |

`appointment:new_order` diterima ketika ada appointment baru yang ditugaskan
atau ketika admin melakukan reassign barber. Frontend harus me-refresh antrean
saat menerima event ini.

Semua command harus memakai acknowledgement callback.

## 13. Admin endpoints terkait barber

Endpoint berikut tersedia di namespace `/api/v1/admin/*` dan membutuhkan token
staff dengan permission `manage_appointment` dan scope cabang yang sesuai.

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/v1/admin/branches/:branchId/barbers` | Daftar barber cabang + live status + jumlah appointment aktif |
| GET | `/api/v1/admin/branches/:branchId/barbers/:barberId/schedule` | Kalender appointment barber per tanggal |
| PATCH | `/api/v1/admin/branches/:branchId/barbers/:barberId/status` | Override status barber (admin) |
| PATCH | `/api/v1/admin/appointments/:id/barber` | Reassign barber ke appointment |

Override status admin (`available`, `serving`, `on_break`, `offline`) menulis
langsung ke DB dan Redis secara sinkron.

Reassign barber mengganti `barber_id` pada appointment aktif, mencatat event
`BARBER_REASSIGNED` di audit trail, dan mengirim `appointment:new_order` ke
barber baru. Gagal `409` jika jadwal barber baru overlap dengan appointment
yang sudah ada.

## 14. Mapping halaman aplikasi barber

| Halaman/fitur | Endpoint |
|---|---|
| Login | `POST /barbers/auth/login` |
| Dashboard utama | `GET /barbers/dashboard/today` |
| Antrean aktif | `GET /barbers/queue` + Socket.IO `appointment:new_order` |
| Detail order | `GET /barbers/appointments/:id` |
| Terima/tolak order | `PATCH /accept`, `POST /reject` |
| Navigasi ke customer | `GET /appointments/:id/navigation` + `POST /tracking` |
| Update lokasi live | Socket.IO `push_barber_location` atau REST `POST /tracking` |
| Tandai tiba | `PATCH /appointments/:id/arrive` |
| Mulai & selesai layanan | `PATCH /start`, `PATCH /complete` |
| Upload dokumentasi | `POST /media/upload` → URL ke `PATCH /complete` |
| Chat dengan customer | `GET/POST /appointments/:id/chat` + socket event |
| Riwayat appointment | `GET /appointments/history` |
| Statistik & komisi | `GET /stats/daily`, `GET /commissions` |
| Riwayat pendapatan | `GET /earnings` |
| Kelola portfolio | `POST/GET/DELETE /portfolio` |
| Ubah status kehadiran | `PATCH /me/status` |
| Profil | `GET /barbers/me` |

## 15. API client TypeScript

```ts
type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T | null;
  errors: unknown;
  meta: unknown;
};

async function barberRequest<T>(
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

Contoh: kirim lokasi GPS

```ts
const snapshot = await barberRequest<TrackingSnapshot>(
  `/api/v1/barbers/appointments/${appointmentId}/tracking`,
  {
    method: "POST",
    body: JSON.stringify({ lat, lng, accuracy_m: accuracy, captured_at: new Date().toISOString() })
  },
  accessToken
);
```

Contoh: upload media dokumentasi lalu selesaikan pelayanan

```ts
const form = new FormData();
form.append("file", afterPhotoBlob, "after.jpg");
form.append("purpose", "appointment_reference");

const media = await barberRequest<MediaAsset>(
  "/api/v1/barbers/media/upload",
  { method: "POST", body: form },
  accessToken
);

await barberRequest(
  `/api/v1/barbers/appointments/${appointmentId}/complete`,
  {
    method: "PATCH",
    body: JSON.stringify({ after_media_url: media.public_url })
  },
  accessToken
);
```

## 16. Route deprecated

Alias deprecated mengirim header:

```http
Deprecation: true
Sunset: Sat, 01 Jan 2028 00:00:00 GMT
Link: </api/v1/barbers/...>; rel="canonical"
```

| Deprecated | Canonical |
|---|---|
| `/api/v1/barber/auth/login` | `/api/v1/barbers/auth/login` |
| `/api/v1/barber/auth/refresh` | `/api/v1/barbers/auth/refresh` |
| `/api/v1/barber/auth/logout` | `/api/v1/barbers/auth/logout` |
| `/api/v1/barber/me` | `/api/v1/barbers/me` |
| `/api/v1/barber/queue` | `/api/v1/barbers/queue` |
| `/api/v1/barber/appointments/*` | `/api/v1/barbers/appointments/*` |
| `/api/v1/barber/dashboard/today` | `/api/v1/barbers/dashboard/today` |
| `/api/v1/barber/stats/daily` | `/api/v1/barbers/stats/daily` |
| `/api/v1/barber/earnings` | `/api/v1/barbers/earnings` |
| `/api/v1/barber/commissions` | `/api/v1/barbers/commissions` |
| `/api/v1/barber/portfolio` | `/api/v1/barbers/portfolio` |
| `/api/v1/barber/media/*` | `/api/v1/barbers/media/*` |

## 17. Gap implementasi yang perlu diketahui frontend

1. `GET /api/v1/barbers/earnings` dan `GET /api/v1/barbers/stats/daily`
   menggunakan sumber data yang sama (`barber_daily_stats`). Kedua endpoint
   saat ini tidak mendukung filter rentang tanggal. Gunakan paginasi jika perlu
   data historis lebih panjang.

2. `PATCH /api/v1/barbers/me/status` (kehadiran: `online`/`offline`/`unavailable`)
   terpisah dari `live_status` barber (`available`/`serving`/`on_break`/`offline`)
   yang dipakai antrean. Tidak ada sinkronisasi otomatis antara keduanya; admin
   mengelola `live_status` melalui endpoint admin.

3. Tracking GPS via Socket.IO (`push_barber_location`) adalah alias event, bukan
   endpoint REST. Gunakan REST `POST /tracking` untuk jaminan penyimpanan dan
   response ETA terkomputasi. Socket.IO cocok untuk update frekuensi tinggi.

4. `customer_media_urls` pada `complete` menerima URL dari endpoint upload media
   barber. URL signed dapat kedaluwarsa; frontend wajib menyimpan `asset_id`
   untuk meminta URL baru sebelum mengirimkan ke `complete`.

5. Endpoint notifikasi khusus barber belum tersedia pada namespace
   `/api/v1/barbers/*`. Notifikasi real-time saat ini disampaikan melalui
   Socket.IO events (`appointment:new_order`, `appointment:status_changed`).
