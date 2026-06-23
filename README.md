# Bomb Barbershop API Services

Backend REST API dan realtime untuk operasional Bomb Barbershop menggunakan Bun, ElysiaJS, Supabase PostgreSQL, Redis, BullMQ, dan Socket.IO.

## Menjalankan development

```bash
bun install
bun run db:migrate
bun run db:seed
bun run dev
```

REST API berjalan pada `APP_PORT`, Socket.IO pada `SOCKET_PORT`, dan Swagger tersedia di `/docs`.

Dokumentasi integrasi frontend customer:

- [Customers API Map](docs/CUSTOMERS_API_MAP.md)
- [Customers API Map JSON](docs/customers-api-map.json)

## Menjalankan production

Jalankan API dan worker sebagai proses terpisah:

```bash
bun run start
bun run worker
```

Pada production:

- Set `NODE_ENV=production`.
- Set `RUN_WORKERS_IN_PROCESS=false`.
- Isi `CORS_ORIGINS` dan `SOCKET_CORS_ORIGINS` dengan origin frontend yang diizinkan.
- Gunakan Redis yang dapat diakses seluruh instance API dan worker.
- Jalankan migration sebelum traffic dialihkan ke versi baru.
- Gunakan `/health` untuk liveness dan `/ready` untuk readiness.

Socket.IO sudah memakai Redis adapter sehingga room dan broadcast dapat bekerja antar-instance. Jika transport polling diaktifkan, load balancer tetap memerlukan sticky session. Untuk deployment yang tidak menyediakan sticky session, set:

```env
SOCKET_WEBSOCKET_ONLY=true
```

## Home service dan live location

Booking customer mendukung:

- `fulfillment_type=in_store`
- `fulfillment_type=home_service`

Home service wajib memiliki `barber_id`, `service_address`, `destination_latitude`, dan `destination_longitude`. Backend memvalidasi lokasi tujuan terhadap `service_radius_km` barber.

Data realtime tidak disimpan di Postgres:

```text
tracking:{appointmentId}:customer
tracking:{appointmentId}:barber
tracking:{appointmentId}:route
tracking:{appointmentId}:session
```

Lokasi memiliki TTL pendek. Tracking session tetap dicatat di Postgres untuk consent, expiry, dan status lifecycle.

### Autentikasi Socket.IO

Token dikirim saat handshake:

```ts
io(SOCKET_URL, {
  transports: ['websocket'],
  auth: { token: accessToken }
});
```

### Event utama

Client wajib menunggu acknowledgement setiap command:

```ts
socket.emit('join_appointment', appointmentId, (result) => {
  // result.success / result.error
});
```

Command:

- `join_appointment`
- `leave_appointment`
- `push_customer_location`
- `push_barber_location`
- `join_branch`

Broadcast:

- `appointment:new_order`
- `appointment:status_changed`
- `appointment:customer_location`
- `appointment:barber_location`
- `appointment:chat_message`
- `auth:expired`

Room appointment hanya dapat diikuti customer pemilik appointment atau barber yang ditugaskan.
Payload `appointment:barber_location` menyediakan `barber_location`,
`customer_location`, `route`, `eta_minutes`, dan `distance_km`. Field
`barbers_location` masih dikirim sebagai alias legacy dan tidak boleh dipakai
untuk integrasi frontend baru.

## Lifecycle appointment

Transisi status dijaga oleh state machine:

```text
pending -> confirmed | cancelled | no_show
confirmed -> in_queue | in_service | cancelled | no_show
in_queue -> in_service | cancelled | no_show
in_service -> completed
```

Status terminal membersihkan seluruh cache lokasi dan menyelesaikan tracking session.

### Integritas booking

Endpoint pembuatan booking dan walk-in wajib mengirim header `Idempotency-Key`.
Booking dibuat melalui RPC PostgreSQL atomik yang memvalidasi cabang, barber,
harga, jam operasional, time-off, overlap jadwal, queue position, dan snapshot
layanan dalam satu transaksi.

`scheduled_end_at` dihitung dari total durasi layanan. Home service memakai
travel buffer sebelum dan sesudah layanan. Jadwal barber aktif dilindungi
exclusion constraint sehingga dua request paralel tidak dapat mengambil slot
yang sama.

Timeout worker dipisahkan:

```text
ORDER_ACCEPTANCE_TIMEOUT     pending -> cancelled
APPOINTMENT_NO_SHOW_TIMEOUT  confirmed/in_queue -> no_show
```

Setiap perubahan status dicatat pada `appointment_events` beserta actor, role,
reason, status sebelum/sesudah, dan versi appointment.

## Keamanan session

Access token dan refresh token terikat pada satu server-side `auth_session`.
Refresh token menggunakan rotation; pemakaian ulang refresh token lama akan
mencabut seluruh session. Logout membutuhkan `refreshToken` pada body dan
langsung mencabut access token yang menggunakan session sama.

Rate limit login dan refresh dikendalikan oleh:

```text
AUTH_LOGIN_RATE_LIMIT_MAX
AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS
AUTH_REFRESH_RATE_LIMIT_MAX
AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS
```

Selama migration auth belum diterapkan, development menggunakan Redis sebagai
compatibility store. Readiness production tetap gagal sampai tabel
`auth_sessions` dan `media_assets` tersedia.

## Media

Foto customer dan dokumentasi barber disimpan pada bucket private
`bomb-private-media`. API hanya mengembalikan signed URL sementara dan
`asset_id`. Signed URL dapat diperbarui melalui:

```text
GET /api/v1/customer/media/:id/url
GET /api/v1/barber/media/:id/url
```

Konten HQ seperti banner dan gambar layanan disimpan pada bucket publik
`bomb-public-media`. Semua upload dicatat pada `media_assets`, divalidasi ukuran,
MIME type, dimensi, dan jumlah piksel.

## Invoice

Customer membaca invoice miliknya melalui:

```text
GET /api/v1/customer/invoices/:invoiceNumber
```

Endpoint `/api/v1/invoices/:invoiceNumber` hanya untuk tautan publik terbatas
dan wajib menerima query `token`. Token disimpan dalam bentuk SHA-256, memiliki
masa berlaku, dan response tidak memuat data pribadi customer.

## Quality checks

```bash
bun run typecheck
bun test
```

Test realtime security berada di `tests/realtime-security.test.ts`.
