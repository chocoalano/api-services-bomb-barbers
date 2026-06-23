# Bomb Barbershop — Admin API Map

Dokumen ini memetakan seluruh API admin yang aktif pada runtime per
22 Juni 2026. Terdapat dua namespace yang dipisahkan berdasarkan scope:

- `/api/v1/admin/*` — operasional cabang; dapat diakses `branch_admin` dan
  `super_admin`.
- `/api/v1/hq/*` — manajemen pusat; hanya `super_admin`.

Swagger interaktif tersedia di:

```text
GET /docs
```

## 1. Konfigurasi frontend

```env
REST_API_URL=http://localhost:3000
SOCKET_URL=http://localhost:3001
```

Header untuk endpoint terproteksi:

```http
Authorization: Bearer <admin_access_token>
Content-Type: application/json
```

Walk-in wajib menggunakan header idempotency:

```http
Idempotency-Key: <nilai-unik-8-sampai-128-karakter>
```

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
  "errors": [{ "field": "body.amount", "message": "Nominal harus lebih dari 0" }],
  "meta": null
}
```

Aturan frontend:

- Gunakan `success`, bukan hanya HTTP status, untuk menentukan hasil request.
- HTTP `401` — token kedaluwarsa; lakukan refresh, jika gagal paksa login ulang.
- HTTP `403` — staff tidak memiliki permission atau scope cabang tidak cocok.
- HTTP `409` — konflik jadwal (walk-in/reassign) atau data sudah ada (double pay,
  komisi sudah dihitung).
- Semua waktu menggunakan ISO 8601/timestamptz. Tampilkan dalam zona
  `Asia/Jakarta`.
- Semua nominal adalah rupiah penuh tanpa desimal.

## 3. Model RBAC dan permission

### Role bawaan

| Role | Scope default | Permission |
|---|---|---|
| `branch_admin` | Per cabang | `manage_appointment`, `manage_payment`, `manage_commission`, `view_audit_log` |
| `super_admin` | Global (HQ) | Semua di atas + `manage_barber`, `manage_branch`, `manage_service`, `manage_staff` |

### Branch scope

Setiap staff punya satu atau lebih assignment `staff_user_roles` dengan
`branch_id`. Jika setidaknya satu role memiliki `branch_id = null`, staff
bersifat **global** (`isGlobal = true`) dan dapat mengakses semua cabang.
`branch_admin` selalu terikat satu cabang.

### Enforcement

Endpoint `/admin/branches/:branchId/*` memeriksa apakah staff memiliki role
yang mencakup `branchId` tersebut. Endpoint `/admin/appointments/:id/*`
membaca `branch_id` dari appointment terlebih dahulu, lalu memverifikasi scope.
Endpoint `/hq/*` mewajibkan role `super_admin` atau permission spesifik HQ.

## 4. Ringkasan seluruh route canonical

### `/api/v1/admin/*` — Operasional Cabang (54 route)

| Domain | Method | Endpoint | Permission / Scope | Fungsi |
|---|---|---|---|---|
| Auth | POST | `/api/v1/admin/auth/login` | Publik | Login admin/staff |
| Auth | POST | `/api/v1/admin/auth/refresh` | Refresh token | Rotasi token |
| Auth | POST | `/api/v1/admin/auth/logout` | Refresh token | Cabut session |
| Auth | GET | `/api/v1/admin/me` | Bearer | Profil staff |
| Cabang | GET | `/api/v1/admin/branches` | Bearer | Daftar cabang sesuai scope staff |
| Appointment | POST | `/api/v1/admin/branches/:branchId/walk-ins` | Branch scope + Idempotency-Key | Catat walk-in |
| Appointment | GET | `/api/v1/admin/branches/:branchId/queue` | Branch scope | Antrean cabang |
| Appointment | PATCH | `/api/v1/admin/appointments/:id/status` | Appointment scope | Ubah status |
| Appointment | PATCH | `/api/v1/admin/appointments/:id/barber` | Appointment scope | Reassign barber |
| Appointment | PATCH | `/api/v1/admin/appointments/:id/destination` | Appointment scope | Perbarui lokasi tujuan |
| Barber | GET | `/api/v1/admin/branches/:branchId/barbers` | `manage_appointment` + branch scope | Daftar barber + live status |
| Barber | GET | `/api/v1/admin/branches/:branchId/barbers/:barberId/schedule` | `manage_appointment` + branch scope | Kalender barber |
| Barber | PATCH | `/api/v1/admin/branches/:branchId/barbers/:barberId/status` | `manage_appointment` + branch scope | Override status barber |
| Dashboard | GET | `/api/v1/admin/branches/:branchId/dashboard/today` | Branch scope | Dashboard hari ini |
| Dashboard | GET | `/api/v1/admin/branches/:branchId/appointments/summary` | Branch scope | Ringkasan appointment |
| Dashboard | GET | `/api/v1/admin/branches/:branchId/payments/summary` | Branch scope | Ringkasan pembayaran |
| Dashboard | GET | `/api/v1/admin/branches/:branchId/commissions/summary` | Branch scope | Ringkasan komisi |
| Komisi | POST | `/api/v1/admin/appointments/:id/calculate-commission` | Appointment scope | Hitung komisi |
| Komisi | GET | `/api/v1/admin/appointments/:id/commission` | Appointment scope | Detail komisi |
| Komisi | GET | `/api/v1/admin/branches/:branchId/commissions` | Branch scope | Laporan komisi cabang |
| Pembayaran | POST | `/api/v1/admin/appointments/:id/payments` | Appointment scope | Buat pembayaran |
| Pembayaran | GET | `/api/v1/admin/payments/:id` | Payment scope | Detail pembayaran |
| Pembayaran | GET | `/api/v1/admin/branches/:branchId/payments` | Branch scope | Daftar pembayaran cabang |
| Pengeluaran | GET | `/api/v1/admin/expenses/branches/:branchId` | Branch scope | Daftar pengeluaran |
| Pengeluaran | POST | `/api/v1/admin/expenses/branches/:branchId` | Branch scope | Catat pengeluaran |
| Pengeluaran | PUT | `/api/v1/admin/expenses/branches/:branchId/:expenseId` | Branch scope | Perbarui pengeluaran |
| Pengeluaran | DELETE | `/api/v1/admin/expenses/branches/:branchId/:expenseId` | Branch scope | Hapus pengeluaran |
| Antrean RT | GET | `/api/v1/admin/branches/:branchId/realtime-queue` | Branch scope | SSE antrean live |
| Audit | GET | `/api/v1/admin/audit-logs` | `view_audit_log` | Rekam jejak perubahan |
| Webhook | POST | `/api/v1/webhooks/payments/:provider` | Publik (signature) | Callback gateway |
| Webhook | POST | `/api/v1/payments/webhook` | Publik (signature) | Callback fixed URL |
| Webhook | POST | `/api/v1/payments/webhook/:provider` | Publik (signature) | Callback parameterized |

### `/api/v1/hq/*` — Manajemen Pusat (23 route, super_admin)

| Domain | Method | Endpoint | Permission | Fungsi |
|---|---|---|---|---|
| Dashboard | GET | `/api/v1/hq/dashboard/today` | `super_admin` | Dashboard global hari ini |
| Dashboard | GET | `/api/v1/hq/branches/summary` | `super_admin` | Ringkasan semua cabang |
| Analytics | GET | `/api/v1/hq/analytics/branches` | `super_admin` | Analytics seluruh cabang |
| Laporan | GET | `/api/v1/hq/reports/revenue/export` | `super_admin` | Export revenue CSV |
| Laporan | GET | `/api/v1/hq/reports/commission/export` | `super_admin` | Export komisi CSV |
| Cabang | GET | `/api/v1/hq/branches` | `super_admin` | Daftar semua cabang aktif |
| Cabang | POST | `/api/v1/hq/branches` | `manage_branch` | Buat cabang |
| Cabang | PUT | `/api/v1/hq/branches/:id` | `manage_branch` | Perbarui cabang |
| Cabang | DELETE | `/api/v1/hq/branches/:id` | `manage_branch` | Hapus cabang |
| Barber | POST | `/api/v1/hq/barbers` | `manage_barber` | Daftarkan barber |
| Barber | PUT | `/api/v1/hq/barbers/:id` | `manage_barber` | Perbarui barber |
| Barber | DELETE | `/api/v1/hq/barbers/:id` | `manage_barber` | Hapus barber |
| Layanan | POST | `/api/v1/hq/services` | `manage_service` | Buat layanan |
| Layanan | PUT | `/api/v1/hq/services/:id` | `manage_service` | Perbarui layanan |
| Layanan | DELETE | `/api/v1/hq/services/:id` | `manage_service` | Hapus layanan |
| Harga | POST | `/api/v1/hq/service-prices` | `manage_service` | Buat harga layanan |
| Harga | PUT | `/api/v1/hq/service-prices/:id` | `manage_service` | Perbarui harga |
| Harga | DELETE | `/api/v1/hq/service-prices/:id` | `manage_service` | Hapus harga |
| RBAC | GET | `/api/v1/hq/staff-users` | `manage_staff` | Daftar semua staff + role |
| RBAC | GET | `/api/v1/hq/roles` | `manage_staff` | Daftar role |
| RBAC | POST | `/api/v1/hq/roles` | `manage_staff` | Buat role baru |
| RBAC | GET | `/api/v1/hq/permissions` | `manage_staff` | Daftar permission |
| RBAC | POST | `/api/v1/hq/staff-users/:id/roles` | `manage_staff` | Assign role ke staff |
| RBAC | DELETE | `/api/v1/hq/staff-users/:id/roles/:roleId` | `manage_staff` | Cabut role staff |
| Barber | GET | `/api/v1/hq/barbers` | `manage_barber` | Daftar semua barber (HQ) |
| Layanan | GET | `/api/v1/hq/services` | `manage_service` | Daftar semua layanan |
| Harga | GET | `/api/v1/hq/service-prices` | `manage_service` | Daftar semua harga layanan |
| Media | POST | `/api/v1/hq/media/upload` | `manage_service` | Upload gambar konten |

## 5. Autentikasi dan profil

### Login

```http
POST /api/v1/admin/auth/login
```

```json
{
  "email": "admin@bombbarbershop.com",
  "password": "AdminPass#2026"
}
```

Response data:

```json
{
  "accessToken": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>"
}
```

JWT memuat role dan scope cabang. Setiap endpoint operasional memverifikasi
kembali permission dan branch scope secara independen.
Error: `401` kredensial salah, `403` akun tidak aktif, `429` rate limit.

### Refresh dan logout

```http
POST /api/v1/admin/auth/refresh
POST /api/v1/admin/auth/logout
```

Body keduanya: `{ "refreshToken": "<refresh-token>" }`.

Refresh menerapkan token rotation — ganti access dan refresh token secara
atomik setelah berhasil.

### Profil staff

```http
GET /api/v1/admin/me
```

```ts
type StaffProfile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  barber: {
    id: string;
    display_name: string;
    branch_id: string;
    live_status: string;
  } | null;
};
```

Field `barber` terisi jika staff juga terdaftar sebagai barber di suatu cabang.

## 6. Appointment dan antrean

### Catat walk-in

```http
POST /api/v1/admin/branches/:branchId/walk-ins
Authorization: Bearer <token>
Idempotency-Key: walkin-pos-20260622-0004
```

```json
{
  "service_ids": ["service-uuid"],
  "barber_id": "barber-uuid",
  "customer_id": "customer-uuid",
  "scheduled_at": "2026-06-22T10:30:00.000Z",
  "media_urls": ["https://..."]
}
```

Wajib: `service_ids` (minimal satu), `Idempotency-Key`. Opsional: `barber_id`,
`customer_id` (anonim jika tidak ada), `scheduled_at` (default sekarang),
`media_urls`.

Backend memvalidasi cabang, barber, harga, jam operasional, time-off, benturan
jadwal, queue position, snapshot layanan, dan idempotency dalam satu transaksi.
Sukses `201`. Error `409` untuk slot overlap atau idempotency conflict.

### Antrean aktif cabang

```http
GET /api/v1/admin/branches/:branchId/queue
```

Mengembalikan appointment berstatus `pending`, `confirmed`, `in_queue`,
`in_service` beserta `barbers.display_name` dan `customers.full_name`, diurutkan
berdasarkan `queue_position`.

### Ubah status appointment

```http
PATCH /api/v1/admin/appointments/:id/status
```

```json
{
  "status": "in_service",
  "reason": "Konfirmasi melalui telepon",
  "cancellation_reason": "Customer meminta pembatalan"
}
```

Nilai `status` valid: `pending`, `confirmed`, `in_queue`, `in_service`,
`completed`, `cancelled`, `no_show`. `reason` dan `cancellation_reason`
opsional; backend membuat alasan default jika kosong.

### Reassign barber

```http
PATCH /api/v1/admin/appointments/:id/barber
```

```json
{
  "barber_id": "barber-uuid"
}
```

Barber baru harus terdaftar di cabang yang sama. Gagal `409` jika jadwal barber
baru overlap. Perubahan dicatat di `appointment_events` sebagai
`BARBER_REASSIGNED` dan barber baru menerima event Socket.IO
`appointment:new_order`.

### Perbarui lokasi tujuan

```http
PATCH /api/v1/admin/appointments/:id/destination
```

```json
{
  "destination_latitude": -6.2277,
  "destination_longitude": 106.8099
}
```

Hanya berlaku untuk appointment `home_service` berstatus `pending`, `confirmed`,
`in_queue`, atau `in_service`. Admin dapat mengubah lokasi bahkan saat barber
sedang dalam perjalanan. Perubahan dicatat ke `audit_logs` dengan
`action: UPDATE_DESTINATION`.

Aturan validasi:

- Nilai `null`, `undefined`, atau persis `0.0` ditolak dengan `"Titik
  potong/lokasi harus diisi"`.
- Latitude -90 s/d 90; longitude -180 s/d 180.

Error: `400` koordinat tidak valid atau status tidak memungkinkan, `404`
appointment tidak ditemukan.

## 7. Manajemen barber cabang

### Daftar barber dengan live status

```http
GET /api/v1/admin/branches/:branchId/barbers
```

Membutuhkan permission `manage_appointment`. Response per barber:

```json
{
  "id": "barber-uuid",
  "display_name": "Budi Santoso",
  "live_status": "available",
  "bio": null,
  "rating_avg": 4.85,
  "rating_count": 120,
  "active_appointment_count": 2,
  "staff_users": { "full_name": "Budi Santoso", "phone": "62811000001" }
}
```

`live_status` diambil dari Redis dengan fallback ke database.
`active_appointment_count` menghitung appointment berstatus
`pending|confirmed|in_queue|in_service`.

### Kalender barber

```http
GET /api/v1/admin/branches/:branchId/barbers/:barberId/schedule?date=2026-06-22
```

Query `date` dalam format `YYYY-MM-DD` UTC; default hari ini. Appointment
berstatus `cancelled` dikecualikan. Response:

```json
{
  "barber": { "id": "...", "display_name": "Budi Santoso", "live_status": "available" },
  "date": "2026-06-22",
  "appointments": [
    {
      "id": "...",
      "status": "in_queue",
      "scheduled_at": "2026-06-22T03:00:00.000Z",
      "schedule_block_start_at": "2026-06-22T03:00:00.000Z",
      "schedule_block_end_at": "2026-06-22T03:45:00.000Z",
      "customers": { "full_name": "Andi Customer" },
      "appointment_services": [{ "services": { "name": "Classic Cut", "default_duration_min": 45 } }]
    }
  ]
}
```

### Override status barber

```http
PATCH /api/v1/admin/branches/:branchId/barbers/:barberId/status
```

```json
{ "status": "offline" }
```

Nilai valid: `available`, `serving`, `on_break`, `offline`. Menulis ke database
dan Redis secara sinkron. Perubahan dicatat ke `audit_logs`.

## 8. Dashboard cabang

```http
GET /api/v1/admin/branches/:branchId/dashboard/today
```

Zona waktu `Asia/Jakarta`. Response:

```json
{
  "total_appointments": 32,
  "booking_count": 12,
  "walk_in_count": 20,
  "total_completed": 25,
  "total_cancelled": 2,
  "revenue": {
    "total": 2500000,
    "service": 2250000,
    "product": 150000,
    "tip": 100000
  },
  "shares": {
    "barber": 1500000,
    "branch": 625000,
    "hq": 375000
  }
}
```

Ringkasan historis (untuk grafik):

```http
GET /api/v1/admin/branches/:branchId/appointments/summary
GET /api/v1/admin/branches/:branchId/payments/summary
GET /api/v1/admin/branches/:branchId/commissions/summary
```

Ketiganya mengembalikan `daily_branch_summaries[]` dengan field: `summary_date`,
`total_revenue`, `total_appointments`, `walk_in_count`, `booking_count`,
`no_show_count`, `hq_share_total`, `branch_share_total`.

## 9. Komisi

### Hitung komisi appointment

```http
POST /api/v1/admin/appointments/:id/calculate-commission
```

Appointment harus sudah memiliki payment berstatus `paid` dan memiliki barber.
Backend memilih commission rule paling spesifik (barber → cabang → global).
Sukses `201`. Error `409` jika komisi sudah pernah dihitung (idempotent).

Response:

```json
{
  "id": "commission-uuid",
  "appointment_id": "...",
  "base_amount": 75000,
  "barber_share": 50000,
  "branch_share": 18750,
  "hq_share": 11250,
  "tip_amount": 5000,
  "calculated_at": "2026-06-22T11:10:00.000Z"
}
```

### Detail komisi

```http
GET /api/v1/admin/appointments/:id/commission
```

Mengembalikan commission entry beserta `commission_rules` yang digunakan,
termasuk persentase `barber_pct`, `branch_pct`, `hq_pct`.

### Laporan komisi cabang

```http
GET /api/v1/admin/branches/:branchId/commissions
```

Ringkasan revenue dan pembagian hasil per tanggal dari `daily_branch_summaries`,
diurutkan dari terbaru.

## 10. Pembayaran dan webhook

### Buat pembayaran

```http
POST /api/v1/admin/appointments/:id/payments
```

Tunai (langsung paid):

```json
{
  "method": "cash",
  "status": "paid"
}
```

Dengan gateway:

```json
{
  "method": "qris",
  "status": "pending",
  "provider": "midtrans",
  "product_amount": 25000,
  "discount_amount": 10000,
  "tip_amount": 5000
}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `method` | Ya | `cash`, `qris`, `card`, `bank_transfer`, `ewallet` |
| `status` | Ya | `pending` atau `paid` (cash) |
| `provider` | Tidak | `midtrans` atau `xendit` |
| `product_amount` | Tidak | Subtotal produk |
| `discount_amount` | Tidak | Total diskon |
| `tip_amount` | Tidak | Tip barber |
| `gateway_reference` | Tidak | ID eksternal dari provider |

Backend menghitung ulang `service_amount` dari snapshot `appointment_services`.
Sukses `201`. Error `409` untuk double-pay protection.

Gunakan `payment_url` atau `redirect_url` dari response untuk mengarahkan ke
halaman pembayaran gateway.

### Detail dan daftar pembayaran

```http
GET /api/v1/admin/payments/:id
GET /api/v1/admin/branches/:branchId/payments
```

Detail payment menyertakan sub-objek `appointments` dan `invoices`
(termasuk `invoice_number`).

### Webhook payment gateway

```http
POST /api/v1/webhooks/payments/:provider
POST /api/v1/payments/webhook
POST /api/v1/payments/webhook/:provider
```

Endpoint publik; tidak membutuhkan token. Backend memverifikasi signature dari
header, menandai payment `paid`, membuat invoice, dan mencatat audit log.

Midtrans:

```json
{
  "order_id": "<payment-uuid>",
  "status_code": "200",
  "transaction_status": "settlement",
  "gross_amount": "95000.00"
}
```

Xendit:

```json
{
  "provider": "xendit",
  "external_id": "<payment-uuid>",
  "status": "PAID"
}
```

## 11. Pengeluaran cabang

```http
GET    /api/v1/admin/expenses/branches/:branchId
POST   /api/v1/admin/expenses/branches/:branchId
PUT    /api/v1/admin/expenses/branches/:branchId/:expenseId
DELETE /api/v1/admin/expenses/branches/:branchId/:expenseId
```

POST body (semua wajib):

```json
{
  "amount": 350000,
  "description": "Pembelian bahan kebersihan dan handuk.",
  "expense_date": "2026-06-22"
}
```

PUT body (minimal satu field):

```json
{
  "amount": 400000,
  "description": "Pembelian bahan kebersihan, handuk, dan sarung barber.",
  "expense_date": "2026-06-23"
}
```

DELETE mengembalikan `data: null` dengan `200`.

## 12. Realtime queue (SSE)

```http
GET /api/v1/admin/branches/:branchId/realtime-queue
```

Membuka koneksi **Server-Sent Events** (`Content-Type: text/event-stream`).
Server mengirim event setiap ~5 detik selama koneksi aktif.

> **Perhatian — token di browser native EventSource:** Browser tidak mengizinkan
> header kustom pada `EventSource` bawaan. Kirim token sebagai query parameter
> `?token=<access_token>` sebagai gantinya. Server menerima token dari header
> **maupun** query param.

```ts
// Opsi 1: query param (browser native EventSource)
const es = new EventSource(
  `${REST_API_URL}/api/v1/admin/branches/${branchId}/realtime-queue?token=${accessToken}`
);

// Opsi 2: header kustom (library seperti @microsoft/fetch-event-source)
import { fetchEventSource } from "@microsoft/fetch-event-source";
fetchEventSource(
  `${REST_API_URL}/api/v1/admin/branches/${branchId}/realtime-queue`,
  {
    headers: { Authorization: `Bearer ${accessToken}` },
    onmessage(ev) {
      if (ev.event === "queue_update") {
        const appointments = JSON.parse(ev.data);
        // update antrean di UI
      }
    }
  }
);
```

Format event:

```text
data: {"type":"queue_update","data":[{"id":"...","barber_id":"...","status":"in_queue","eta":{"eta_minutes":12}}]}
```

Gunakan untuk layar monitor kasir atau display antrean. Tutup koneksi saat
halaman tidak aktif untuk menghemat koneksi server.

## 13. Audit log

```http
GET /api/v1/admin/audit-logs
```

Membutuhkan permission `view_audit_log`.

| Query | Keterangan |
|---|---|
| `entity_type` | Filter jenis entitas: `payments`, `appointments`, `barbers`, dll |
| `entity_id` | UUID entitas spesifik |
| `branch_id` | Filter log cabang tertentu |
| `limit` | 1–500, default 50 |
| `offset` | Mulai dari record ke-N, default 0. Gunakan bersama `limit` untuk paginasi. |

Response menyertakan field `meta` untuk navigasi halaman:

```json
{
  "meta": { "total": 1240, "limit": 50, "offset": 0 }
}
```

Untuk halaman berikutnya: `?limit=50&offset=50`.

Response item:

```json
{
  "id": "audit-uuid",
  "actor_type": "admin",
  "actor_id": "staff-uuid",
  "action": "SET_BARBER_STATUS",
  "entity_type": "barbers",
  "entity_id": "barber-uuid",
  "branch_id": "branch-uuid",
  "before": null,
  "after": { "status": "offline" },
  "created_at": "2026-06-22T10:05:00.000Z"
}
```

Aksi yang tercatat: `SET_BARBER_STATUS`, `REASSIGN_BARBER`, `UPDATE_DESTINATION`,
`CREATE_PAYMENT`, `CALCULATE_COMMISSION`, dan lainnya yang ditambahkan seiring
pengembangan.

## 14. Master data HQ

Seluruh endpoint di bawah membutuhkan `super_admin` atau permission spesifik HQ.

### Manajemen cabang

```http
POST   /api/v1/hq/branches
PUT    /api/v1/hq/branches/:id
DELETE /api/v1/hq/branches/:id
```

POST body:

```json
{
  "name": "Bomb Barbershop Jakarta Ancol",
  "region_id": "region-uuid",
  "address": "Jl. Lodan Raya No. 1, Jakarta Utara",
  "phone": "021-22770012",
  "latitude": -6.175662,
  "longitude": 106.599256,
  "is_active": true
}
```

Wajib: `name`, `region_id`. Opsional: `address`, `phone`, `latitude`,
`longitude`, `is_active`. PUT menerima semua field opsional. DELETE melakukan
soft-delete.

### Manajemen barber (HQ)

```http
POST   /api/v1/hq/barbers
PUT    /api/v1/hq/barbers/:id
DELETE /api/v1/hq/barbers/:id
```

POST body:

```json
{
  "staff_user_id": "staff-uuid",
  "branch_id": "branch-uuid",
  "display_name": "Budi Santoso",
  "bio": "Spesialis fade dan classic cut.",
  "service_radius_km": 5
}
```

### Manajemen layanan

```http
POST   /api/v1/hq/services
PUT    /api/v1/hq/services/:id
DELETE /api/v1/hq/services/:id
```

POST body:

```json
{
  "name": "Premium Haircut",
  "default_duration_min": 45,
  "description": "Potong rambut premium termasuk konsultasi dan styling.",
  "image_url": "https://...",
  "is_active": true
}
```

### Manajemen harga layanan

```http
POST   /api/v1/hq/service-prices
PUT    /api/v1/hq/service-prices/:id
DELETE /api/v1/hq/service-prices/:id
```

POST body:

```json
{
  "service_id": "service-uuid",
  "price_amount": 85000,
  "effective_from": "2026-06-01T00:00:00.000Z",
  "branch_id": "branch-uuid",
  "region_id": null,
  "effective_to": null
}
```

Prioritas harga: `branch_id` → `region_id` → global (keduanya null). Gunakan
`effective_to` untuk menjadwalkan kenaikan harga.

## 15. RBAC — role dan assignment

```http
GET    /api/v1/hq/roles
POST   /api/v1/hq/roles
GET    /api/v1/hq/permissions
POST   /api/v1/hq/staff-users/:id/roles
DELETE /api/v1/hq/staff-users/:id/roles/:roleId
```

### Buat role

```json
{ "name": "cashier" }
```

Nama role menggunakan `snake_case`. Permission belum otomatis terpasang dan
harus dikelola langsung di tabel `role_permissions`.

### Assign role ke staff

```json
{
  "role_id": "role-uuid",
  "branch_id": "branch-uuid"
}
```

Hilangkan `branch_id` untuk role global/HQ (`isGlobal = true`). Untuk
`branch_admin`, sertakan `branch_id` agar scope terbatas pada cabang tersebut.

`GET /api/v1/hq/permissions` mengembalikan semua kode permission yang tersedia
untuk membangun matriks akses di frontend admin.

## 16. Analytics dan export HQ

### Dashboard global

```http
GET /api/v1/hq/dashboard/today
GET /api/v1/hq/branches/summary
```

`dashboard/today` mengembalikan metrik konsolidasi seluruh cabang pada hari
berjalan (format sama dengan dashboard cabang).

`branches/summary` mengembalikan `daily_branch_summaries` semua cabang beserta
`branches.name`.

### Analytics cabang

```http
GET /api/v1/hq/analytics/branches
```

Maksimal 100 daily summaries terbaru beserta nama cabang. Gunakan untuk grafik
perbandingan performa antar cabang.

### Export CSV

```http
GET /api/v1/hq/reports/revenue/export?start_date=2026-06-01T00:00:00.000Z&end_date=2026-06-30T23:59:59.000Z&branch_id=<uuid>
GET /api/v1/hq/reports/commission/export?start_date=...&end_date=...&barber_id=<uuid>
```

Response `Content-Type: text/csv`. Semua query opsional dan dapat
dikombinasikan. Revenue export mencakup invoice ID, appointment ID, nama cabang,
total, dan tanggal. Commission export mencakup barber, base amount, barber share,
dan tip.

## 17. Media HQ

```http
POST /api/v1/hq/media/upload
Content-Type: multipart/form-data
```

Form:

```text
file=<binary JPG|PNG|WEBP, maks 5 MB>
category=promotion
```

`category` opsional: `promotion`, `service`, `portfolio`, `branch`, `general`.
File disimpan di bucket **publik** (`bomb-public-media`), berbeda dengan media
barber/customer yang private.

Response:

```json
{
  "asset_id": "asset-uuid",
  "bucket": "bomb-public-media",
  "path": "promotion/asset-uuid.webp",
  "visibility": "public",
  "public_url": "https://project.supabase.co/storage/v1/object/public/bomb-public-media/promotion/asset-uuid.webp",
  "content_type": "image/webp",
  "size": 184320,
  "width": 1080,
  "height": 1350,
  "category": "promotion"
}
```

`public_url` adalah URL permanen yang dapat langsung digunakan sebagai
`image_url` pada layanan atau banner konten.

## 18. Dashboard HQ vs Dashboard Cabang

| Aspek | Dashboard Cabang | Dashboard HQ |
|---|---|---|
| Endpoint | `/admin/branches/:branchId/dashboard/today` | `/hq/dashboard/today` |
| Auth | Branch scope | `super_admin` |
| Scope data | Satu cabang | Konsolidasi semua cabang |
| Ringkasan historis | `/appointments/summary`, `/payments/summary`, `/commissions/summary` | `/hq/branches/summary` |

## 19. Mapping halaman web admin

| Halaman/fitur | Endpoint |
|---|---|
| Login | `POST /admin/auth/login` |
| Daftar cabang (selector UI) | `GET /admin/branches` |
| Dashboard cabang | `GET /admin/branches/:id/dashboard/today` |
| Monitor antrean live | `GET /admin/branches/:id/realtime-queue` (SSE) |
| Antrean snapshot | `GET /admin/branches/:id/queue` |
| Catat walk-in | `POST /admin/branches/:id/walk-ins` |
| Update status appointment | `PATCH /admin/appointments/:id/status` |
| Reassign barber | `PATCH /admin/appointments/:id/barber` |
| Ubah lokasi tujuan | `PATCH /admin/appointments/:id/destination` |
| Daftar barber + status | `GET /admin/branches/:id/barbers` |
| Kalender barber | `GET /admin/branches/:id/barbers/:bId/schedule` |
| Override status barber | `PATCH /admin/branches/:id/barbers/:bId/status` |
| Buat pembayaran kasir | `POST /admin/appointments/:id/payments` |
| Daftar transaksi | `GET /admin/branches/:id/payments` |
| Hitung komisi | `POST /admin/appointments/:id/calculate-commission` |
| Laporan komisi | `GET /admin/branches/:id/commissions` |
| Catat pengeluaran | `POST /admin/expenses/branches/:id` |
| Rekam jejak | `GET /admin/audit-logs?branch_id=...` |
| Dashboard global HQ | `GET /hq/dashboard/today` |
| Perbandingan cabang | `GET /hq/analytics/branches` |
| Export keuangan | `GET /hq/reports/revenue/export` |
| Daftar semua cabang (HQ) | `GET /hq/branches` |
| Master data cabang | `POST/PUT/DELETE /hq/branches` |
| Master data barber | `POST/PUT/DELETE /hq/barbers` |
| Master data layanan | `POST/PUT/DELETE /hq/services`, `/hq/service-prices` |
| Manajemen akses staff | `GET/POST /hq/roles`, `POST/DELETE /hq/staff-users/:id/roles` |
| Upload gambar konten | `POST /hq/media/upload` |

## 20. API client TypeScript

```ts
type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T | null;
  errors: unknown;
  meta: unknown;
};

async function adminRequest<T>(
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
    throw { status: response.status, message: payload.message, errors: payload.errors };
  }
  return payload.data as T;
}
```

Download CSV (`revenue/export`, `commission/export` — bukan JSON):

```ts
async function downloadCSV(path: string, filename: string, accessToken: string) {
  const response = await fetch(`${REST_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Export gagal: ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Penggunaan
downloadCSV(
  `/api/v1/hq/reports/revenue/export?start_date=2026-06-01T00:00:00.000Z&end_date=2026-06-30T23:59:59.000Z`,
  "revenue_export.csv",
  accessToken
);
```

Walk-in:

```ts
const apt = await adminRequest<Appointment>(
  `/api/v1/admin/branches/${branchId}/walk-ins`,
  {
    method: "POST",
    headers: { "Idempotency-Key": `walkin-${crypto.randomUUID()}` },
    body: JSON.stringify({ service_ids: [serviceId], barber_id: barberId })
  },
  accessToken
);
```

SSE antrean (gunakan `?token=` untuk browser native EventSource):

```ts
const es = new EventSource(
  `${REST_API_URL}/api/v1/admin/branches/${branchId}/realtime-queue?token=${accessToken}`
);
es.addEventListener("queue_update", (e) => {
  const { data: queue } = JSON.parse(e.data);
  setQueue(queue);
});
```

## 21. Catatan perilaku penting untuk frontend

| # | Topik | Status | Keterangan |
|---|---|---|---|
| 1 | `/destination` hanya untuk `home_service` | Desain | Kirim ke appointment `in_store` menghasilkan `400`. Sembunyikan tombol di UI jika `fulfillment_type !== 'home_service'`. |
| 2 | Branch scope dibaca dari DB, bukan URL | Desain | `/admin/appointments/:id/*` memeriksa `appointments.branch_id` saat runtime. Staff harus memiliki scope cabang yang sesuai. |
| 3 | Export CSV bukan JSON | Desain | `GET /hq/reports/revenue/export` dan `commission/export` mengembalikan `text/csv`. Gunakan `downloadCSV()` helper di section 20, bukan `adminRequest`. |
| 4 | SSE token via `?token=` | **Diperbaiki** | Server kini menerima token dari header **maupun** query param `?token=`. Gunakan query param untuk browser native `EventSource` (lihat section 12). |
| 5 | Audit logs pagination | **Diperbaiki** | Endpoint kini mendukung `?limit=N&offset=N`. Response `meta` menyertakan `total`, `limit`, dan `offset` (lihat section 13). |
| 6 | `manage_staff` tidak ada di `branch_admin` | Desain intentional | Hanya `super_admin` yang dapat mengelola role dan assignment staff. Sembunyikan fitur RBAC dari UI `branch_admin`. |
