Berikut rencana bertahap untuk menutup seluruh gap tanpa mengubah semuanya sekaligus.

## Prinsip pelaksanaan

- Prioritaskan keamanan, integritas transaksi, dan live pickup.
- Setiap tahap harus memiliki migration, implementasi, Swagger, test, dan rollback plan.
- Route lama tidak langsung dihapus; gunakan deprecation period agar frontend dapat bermigrasi.
- Semua perubahan status dan transaksi penting harus idempoten dan aman terhadap request bersamaan.

## Tahap 0 — Persiapan database

Prioritas: blocker

1. Perbarui `DATABASE_URL` Supabase.
2. Backup database production.
3. Audit data sebelum migration:
   - Tracking session aktif ganda.
   - Check-in ganda.
   - Appointment tanpa cabang/barber valid.
4. Jangan langsung menghapus duplikasi. Arsipkan dahulu ke tabel audit.
5. Terapkan migration home-service di staging.
6. Regenerasi `src/types/supabase.ts`.
7. Jalankan smoke test booking, tracking, dan check-in.
8. Terapkan migration production dengan maintenance window.

Definition of done:

- Kolom home-service tersedia.
- Unique index tracking/check-in aktif.
- Tidak ada data production hilang tanpa arsip.
- Rollback SQL tersedia.

## Tahap 1 — Autentikasi dan privasi

Prioritas: kritis

### Auth

- Tambahkan filter `deleted_at IS NULL` pada seluruh middleware customer, staff, dan barber.
- `requireBarber` wajib memeriksa barber belum dihapus dan staff masih aktif.
- Tambahkan tabel `auth_sessions` untuk refresh token:
  - `jti`
  - user ID dan tipe user
  - expiry
  - revoked timestamp
  - device metadata
- Refresh token rotation: token lama dicabut setelah digunakan.
- Logout benar-benar mencabut session.
- Tambahkan rate limit login dan refresh.
- Tambahkan audit untuk login gagal berulang.

### Media

- Customer route hanya menerima token customer.
- Barber route hanya menerima staff yang memiliki profil barber.
- Pindahkan foto customer dari local `/public` ke private Supabase Storage.
- Gunakan signed URL dengan expiry.
- Portfolio dan banner boleh memakai bucket publik terpisah.
- Tambahkan tabel `media_assets` untuk ownership, purpose, ukuran, dan lifecycle cleanup.
- Batasi dimensi/pixel gambar selain ukuran file.

### Invoice

- Ubah invoice menjadi endpoint terproteksi berdasarkan ownership.
- Jika link publik diperlukan, gunakan token acak berentropi tinggi dan response yang sudah disensor.
- Jangan mengembalikan `appointments(*)`.

Definition of done:

- Akun soft-delete langsung kehilangan akses.
- Refresh token tidak dapat digunakan ulang.
- Foto customer tidak dapat diakses tanpa izin.
- Customer dan barber tidak dapat menggunakan media route domain lain.

## Tahap 2 — Integritas booking dan appointment

Prioritas: kritis

### Status lifecycle

- Hapus kemampuan customer melakukan `pending → confirmed`.
- Customer hanya boleh membatalkan appointment.
- `confirmed` hanya dapat dilakukan barber/admin.
- Tambahkan actor dan reason pada setiap transition.
- Pisahkan event:
  - `ORDER_ACCEPTANCE_TIMEOUT`
  - `APPOINTMENT_NO_SHOW_TIMEOUT`

### Auto-cancel

- Pending acceptance timeout dihitung dari waktu order dibuat.
- No-show dihitung dari `scheduled_at + grace_period`.
- Appointment `confirmed` tidak boleh dibatalkan satu jam setelah pembuatan.
- No-show harus menghasilkan status `no_show`, bukan `cancelled`.

### Booking atomik

Buat RPC PostgreSQL melalui Supabase SDK, misalnya `create_appointment_atomic`, yang:

- Memvalidasi branch aktif.
- Memvalidasi barber aktif dan berasal dari branch tersebut.
- Memvalidasi layanan dan harga.
- Memvalidasi operating hours dan barber time-off.
- Menghitung durasi dan `scheduled_end_at`.
- Mendeteksi overlap jadwal.
- Mengunci perhitungan queue position.
- Membuat appointment dan snapshot service dalam satu transaksi.

Tambahkan:

- `scheduled_end_at`.
- `idempotency_key`.
- Unique constraint idempotency.
- Exclusion constraint jadwal barber aktif.
- Travel buffer untuk home-service.

Definition of done:

- Dua request bersamaan tidak bisa memesan barber pada slot yang sama.
- Retry request tidak menghasilkan appointment ganda.
- Barber lintas cabang tidak dapat dipilih.
- Booking masa lalu dan cabang nonaktif ditolak.

## Tahap 3 — Live pickup customer–barber

Prioritas: kritis

### Tracking lifecycle

Tracking hanya dapat dimulai ketika:

- `fulfillment_type = home_service`
- status `confirmed` atau `in_queue`
- customer sudah memberikan consent

Tambahkan endpoint:

- `POST /customers/appointments/:id/tracking/revoke`
- `GET /barbers/appointments/:id/tracking`
- `GET /barbers/appointments/:id`

### Location validation

- Tolak `captured_at` yang lebih lama atau sama dengan lokasi terakhir.
- Terapkan minimum kualitas GPS, misalnya maksimal accuracy 50–100 meter.
- Pertahankan jump-speed validation.
- Tambahkan monotonic sequence dari client.
- Debounce perhitungan route provider.
- Simpan route snapshot terakhir agar reconnect tidak kehilangan ETA.

### Geofence

- Check-in GPS wajib berada dalam radius cabang.
- Barber `arrive` wajib berada dalam radius destination customer.
- Metode `manual` hanya boleh dilakukan admin/barber, bukan customer.
- Catat jarak aktual ketika check-in/arrive.

### Konsistensi lifecycle

Gunakan transactional outbox:

1. Status appointment diperbarui.
2. Event ditulis ke `appointment_events`.
3. Worker memproses:
   - Redis status.
   - Cleanup tracking.
   - Socket broadcast.
   - Retry jika gagal.

Definition of done:

- Kegagalan Redis/Socket tidak membuat status database setengah selesai.
- Barber reconnect dapat mengambil destination dan route terbaru.
- Customer dapat mencabut consent.
- Arrive/check-in tidak dapat dilakukan dari lokasi sembarang.

## Tahap 4 — Perbaikan queue dan dashboard barber

Prioritas: tinggi

Queue barber harus mengambil:

- `fulfillment_type`
- `service_address`
- destination coordinates
- location notes
- customer media
- route dan ETA dari key tracking baru
- status journey

Jangan membaca ETA dari `appointment:eta:*` legacy.

Perbaiki earnings:

- `commission_earned` hanya komisi tanpa tip; atau
- ganti nama menjadi `barber_share_including_tip`.
- Pastikan `total_earnings` tidak menghitung tip dua kali.

Tambahkan pagination pada:

- Riwayat appointment barber.
- Statistik.
- Earnings.
- Komisi.
- Portfolio.

Definition of done:

- Barber melihat alamat pickup yang benar.
- ETA dashboard sama dengan ETA tracking customer.
- Nilai komisi dan tip tidak ambigu.

## Tahap 5 — Normalisasi route

Prioritas: tinggi, membutuhkan koordinasi frontend

Canonical namespace:

```text
/api/v1/customers/*
/api/v1/barbers/*
/api/v1/admin/*
/api/v1/hq/*
```

Pindahkan route customer-owned:

```text
/customers/catalog/branches
/customers/content/banners
/customers/content/gallery
/customers/notifications
/customers/media
/customers/invoices
```

Hapus ketergantungan frontend baru terhadap:

```text
/api/v1/staff/*
/api/v1/media/upload
/api/v1/notifications
/payment dan /payments bersamaan
/review dan /reviews bersamaan
```

Strategi deprecation:

1. Tentukan satu route canonical.
2. Alias lama tetap aktif sementara.
3. Tambahkan header `Deprecation`, `Sunset`, dan `Link`.
4. Tambahkan logging penggunaan route lama.
5. Hapus setelah frontend tidak lagi menggunakannya.

Definition of done:

- Setiap route dapat ditentukan ownership-nya dari prefix.
- Swagger hanya menonjolkan route canonical.
- Tidak ada alias tanpa tanggal penghentian.

## Tahap 6 — Route frontend yang belum tersedia

### Customers

- Update profile.
- Mark notification read/read-all.
- Revoke tracking consent.
- Payment status berdasarkan appointment.
- Secure invoice receipt.

### Barbers

- Appointment detail.
- Appointment history.
- Reject order dengan reason.
- Mark customer no-show.
- Tracking snapshot.
- Presence status: online, offline, unavailable.
- Current destination dan navigation data.

Definition of done:

- Frontend tidak perlu menggabungkan data internal dari beberapa route untuk satu layar utama.
- Semua mutation memiliki ownership dan state-transition validation.

## Tahap 7 — Chat dan abuse protection

- Batas panjang pesan.
- Rate limit per user dan appointment.
- `client_message_id` untuk mencegah pesan ganda.
- Cursor pagination berdasarkan `created_at/id`.
- Batasi pengiriman setelah periode tertentu ketika appointment terminal.
- Tambahkan unread count dan read receipt bila dibutuhkan frontend.

## Tahap 8 — Swagger dan kontrak API

- Buat TypeBox response schema konkret untuk setiap endpoint.
- Hindari `data: any`.
- Standarkan envelope auth/RBAC dengan:
  - `success`
  - `message`
  - `data`
  - `errors`
  - `meta`
- Gabungkan seluruh contoh error yang memiliki status sama.
- Tambahkan `operationId` unik.
- Dokumentasikan route deprecated.
- Tambahkan schema Socket.IO terpisah:
  - command
  - acknowledgement
  - broadcast
  - error codes

Definition of done:

- Frontend dapat menghasilkan TypeScript client dari OpenAPI.
- Tidak ada duplicate `operationId`.
- Contoh Swagger sesuai response runtime.

## Tahap 9 — Test dan observability

Tambahkan test wajib:

- Soft-deleted account ditolak.
- Cross-role media ditolak.
- Refresh token reuse ditolak.
- Customer tidak bisa mengonfirmasi order.
- Double booking concurrency.
- Queue position concurrency.
- Booking masa depan tidak auto-cancel lebih awal.
- Geofence check-in/arrive.
- Stale location tidak menimpa lokasi baru.
- Redis/Socket failure recovery.
- Route prefix contract.
- Deprecated route telemetry.
- Private media authorization.

Observability:

- Metric tracking update/second.
- Routing provider latency/error.
- Socket active connections.
- Location rejection reason.
- Appointment transition failure.
- Outbox retry/dead-letter.
- Booking conflict rate.

## Urutan implementasi yang disarankan

1. Migration dan schema.
2. Auth, media, dan invoice security.
3. Booking atomik dan auto-cancel.
4. Tracking/geofence/outbox.
5. Queue dan dashboard barber.
6. Route canonical dan deprecation.
7. Missing frontend routes.
8. Swagger dan generated client.
9. Load test, security test, lalu rollout production.

Jangan memulai perubahan namespace route sebelum keamanan, database, dan lifecycle stabil karena perubahan prefix membutuhkan koordinasi langsung dengan frontend.