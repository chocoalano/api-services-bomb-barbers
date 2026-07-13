# Panduan Deployment Produksi (Tanpa Docker)

Panduan komprehensif men-deploy **Bomb Barbershop API Services** langsung di atas
sistem operasi Linux (bare-metal / VM / VPS) tanpa container. Stack: **Bun +
ElysiaJS + MySQL 8 + Redis + BullMQ + Socket.IO**, dengan frontend backoffice
(Inertia + Vue 3 + Nuxt UI) yang di-*build* menjadi aset statis.

Target contoh: **Ubuntu 22.04/24.04 LTS**. Untuk distro lain (Debian, RHEL,
Amazon Linux) sesuaikan perintah paketnya; konsep tetap sama.

---

## 1. Arsitektur & Topologi Proses

Aplikasi terdiri dari **beberapa proses terpisah** yang semuanya dijalankan oleh
runtime Bun. Di produksi, jangan menggabungkan worker ke dalam proses API.

| Proses | Entry point | Port default | Peran |
|--------|-------------|--------------|-------|
| **API** | `src/server.ts` | `APP_PORT=3000` (REST) + `SOCKET_PORT=3001` (Socket.IO) | REST API `/api/v1`, realtime tracking, health/ready |
| **Worker** | `src/worker.ts` | — (tanpa port) | Job BullMQ: timeout order, no-show, reminder, expiry order |
| **Web/Backoffice** | `src/web/server.ts` | `WEB_PORT=5174` | Menyajikan SPA backoffice (Inertia) + aset build |

Dependensi eksternal wajib:

- **MySQL 8.x** — penyimpanan utama (Drizzle ORM + `mysql2`).
- **Redis** — cache, rate-limit, lokasi realtime (TTL), dan backend BullMQ +
  Socket.IO Redis adapter.

### Dua pilihan topologi

**A. Split (direkomendasikan untuk produksi skala menengah–besar)**
Tiga service systemd: `api`, `worker`, `web`. Nginx mem-*proxy* ketiganya.
Bisa di-*scale* horizontal (banyak instance API/worker berbagi 1 Redis + 1 MySQL).

**B. Fullstack satu port (`src/server-fullstack.ts`)**
API + aset build + halaman backoffice disajikan dari **satu origin/port** (cocok
untuk 1 domain / 1 tunnel). Worker tetap proses terpisah. Pilih ini untuk
deployment sederhana / single-node. Lihat [§9.4](#94-alternatif-fullstack-satu-port).

---

## 2. Prasyarat Server

- CPU 2 vCPU / RAM 2 GB minimum (4 GB disarankan bila MySQL + Redis satu host).
- Akses `sudo`.
- Domain/subdomain yang mengarah ke IP server (untuk TLS).
- Port keluar terbuka untuk paket & (opsional) gateway pembayaran.

Software yang akan dipasang: **Bun ≥ 1.3.10**, **MySQL 8**, **Redis**, **Nginx**,
**git**, **certbot** (TLS).

---

## 3. Instalasi Dependensi Sistem

### 3.1 Update & tool dasar

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git unzip build-essential ca-certificates
```

### 3.2 Bun (runtime)

Pasang Bun untuk user *deploy* yang akan menjalankan aplikasi (bukan root).
Contoh membuat user khusus `bomb`:

```bash
sudo adduser --system --group --home /opt/bomb bomb
sudo -u bomb -H bash -lc 'curl -fsSL https://bun.sh/install | bash'
# Bun terpasang di /opt/bomb/.bun/bin/bun
sudo -u bomb -H bash -lc '~/.bun/bin/bun --version'   # pastikan >= 1.3.10
```

Catat path absolut Bun (mis. `/opt/bomb/.bun/bin/bun`) — dipakai di unit systemd.

### 3.3 MySQL 8

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
sudo mysql_secure_installation   # set root password, hapus anonymous, dsb.
```

### 3.4 Redis

```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping   # -> PONG
```

Untuk produksi, amankan Redis: bind ke `127.0.0.1` (atau jaringan privat) dan set
`requirepass` di `/etc/redis/redis.conf`, lalu pakai `REDIS_URL=redis://:password@host:6379`.

### 3.5 Nginx & Certbot

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
sudo apt install -y certbot python3-certbot-nginx
```

---

## 4. Menyiapkan Database MySQL

Buat database + user aplikasi (jangan pakai `root` untuk aplikasi):

```sql
sudo mysql -u root -p
```

```sql
CREATE DATABASE bun_bomb_barber
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'bomb'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT';
GRANT ALL PRIVILEGES ON bun_bomb_barber.* TO 'bomb'@'localhost';
FLUSH PRIVILEGES;
```

> Zona waktu: aplikasi membaca/menulis `DATETIME` sebagai **UTC** (`timezone: 'Z'`
> di pool `mysql2`). Tidak perlu mengubah timezone MySQL, tetapi pastikan konsisten.

---

## 5. Mengambil & Menyiapkan Kode

```bash
sudo -u bomb -H bash -l
cd /opt/bomb
git clone <URL_REPO> api-services
cd api-services

# Install dependensi (lockfile terkunci untuk build reprodusibel).
~/.bun/bin/bun install --frozen-lockfile
```

> Migrasi SQL sudah ter-*commit* di folder `drizzle/` sehingga `drizzle-kit`
> (devDependency) **tidak** dibutuhkan di server. `vite` dan `@nuxt/ui` untuk
> build web sudah berada di `dependencies`, jadi build tetap jalan meski Anda
> memakai `bun install --production`.

---

## 6. Konfigurasi Environment (`.env`)

Buat file `.env` di root proyek. Bun memuatnya otomatis. **Jangan commit `.env`**
(sudah masuk `.gitignore`).

### 6.1 Database — dua cara

Proyek mendukung **dua** gaya konfigurasi database (pilih salah satu):

```env
# Cara 1 — URL utuh (menang bila di-set):
DATABASE_URL=mysql://bomb:GANTI_PASSWORD_KUAT@localhost:3306/bun_bomb_barber

# Cara 2 — bagian terpisah (dipakai bila DATABASE_URL/MYSQL_URL kosong):
DATABASE_SERVER=localhost
DATABASE_PORT=3306
DATABASE_USER=bomb
DATABASE_PASSWORD=GANTI_PASSWORD_KUAT
DATABASE_NAME=bun_bomb_barber
```

Prioritas resolusi: `DATABASE_URL` / `MYSQL_URL` → bagian terpisah
(`DATABASE_SERVER` + `DATABASE_NAME` [+ `PORT`/`USER`/`PASSWORD`]) → default lokal.
Kredensial di-URL-encode otomatis, dan password kosong didukung.

### 6.2 `.env` produksi lengkap (contoh)

```env
# ── Runtime ───────────────────────────────────────────────
NODE_ENV=production
APP_PORT=3000
SOCKET_PORT=3001
WEB_PORT=5174

# ── Database (pilih salah satu gaya di §6.1) ──────────────
DATABASE_URL=mysql://bomb:GANTI_PASSWORD_KUAT@localhost:3306/bun_bomb_barber

# ── Redis ─────────────────────────────────────────────────
REDIS_URL=redis://127.0.0.1:6379

# ── Worker: WAJIB false di produksi (worker proses terpisah) ─
RUN_WORKERS_IN_PROCESS=false

# ── JWT (WAJIB kuat, min 32 char, bukan default!) ─────────
# Generate: openssl rand -hex 32
JWT_ACCESS_SECRET=<hasil openssl rand -hex 32>
JWT_REFRESH_SECRET=<hasil openssl rand -hex 32 yang berbeda>
JWT_REFRESH_TTL_SECONDS=604800

# ── CORS: WAJIB di produksi, isi origin frontend yang diizinkan ─
CORS_ORIGINS=https://app.domainanda.com
SOCKET_CORS_ORIGINS=https://app.domainanda.com
# Set true HANYA jika transport polling dipakai tanpa sticky session:
SOCKET_WEBSOCKET_ONLY=true

# ── Reverse proxy: set true HANYA di belakang proxy tepercaya ─
TRUST_PROXY=true

# ── Rate limit auth ───────────────────────────────────────
AUTH_LOGIN_RATE_LIMIT_MAX=5
AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
AUTH_REFRESH_RATE_LIMIT_MAX=20
AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS=60

# ── Media (disk lokal) ────────────────────────────────────
MEDIA_BASE_URL=https://api.domainanda.com
MEDIA_PRIVATE_DIR=storage/private
MEDIA_SIGN_SECRET=<openssl rand -hex 32>   # kosong = pakai JWT_ACCESS_SECRET
MEDIA_SIGNED_URL_TTL_SECONDS=3600

# ── Booking & lifecycle ───────────────────────────────────
ORDER_ACCEPTANCE_TIMEOUT_MINUTES=60
APPOINTMENT_NO_SHOW_GRACE_MINUTES=15
HOME_SERVICE_TRAVEL_BUFFER_MINUTES=15
UNPAID_ORDER_EXPIRY_MINUTES=120

# ── Payment gateway (isi sesuai akun; opsional) ───────────
MIDTRANS_SERVER_KEY=Mid-server-xxxx
MIDTRANS_CLIENT_KEY=Mid-client-xxxx
MIDTRANS_IS_PRODUCTION=true
XENDIT_CALLBACK_TOKEN=

# ── Logging (opsional) ────────────────────────────────────
LOG_LEVEL=info
```

Lihat `.env.example` untuk daftar variabel lengkap (tracking, geofence, wallet,
routing API, dsb.) beserta default-nya.

### 6.3 Checklist keamanan env produksi

- [ ] `JWT_ACCESS_SECRET` & `JWT_REFRESH_SECRET` acak, ≥ 32 karakter, berbeda,
      **bukan** nilai default — boot **gagal** jika lemah/kosong.
- [ ] `CORS_ORIGINS` terisi — API **menolak boot** di produksi bila kosong.
- [ ] `RUN_WORKERS_IN_PROCESS=false`.
- [ ] `TRUST_PROXY=true` hanya karena berada di belakang Nginx (yang menulis
      ulang `X-Forwarded-For`). Jika salah, rate-limit bisa di-bypass.
- [ ] Database & Redis tidak terekspos publik.

---

## 7. Build Frontend Backoffice

Backoffice di-*compile* Vite menjadi aset statis di `public/build/`.

`VITE_API_BASE_URL` menentukan ke mana browser memanggil API:

- **Topologi split** (web & API beda origin): set ke URL absolut API, mis.
  `VITE_API_BASE_URL=https://api.domainanda.com`.
- **Fullstack satu origin**: biarkan **kosong** (`.env.production` bawaan repo
  sudah kosong) agar panggilan bersifat *same-origin*/relatif.

```bash
cd /opt/bomb/api-services
~/.bun/bin/bun run build:web    # -> public/build/ (+ manifest.json)
```

> Jalankan ulang build setiap kali ada perubahan kode frontend atau nilai
> `VITE_*` berubah (nilai di-*inline* ke bundle saat build).

---

## 8. Migrasi & Seed Database

```bash
cd /opt/bomb/api-services

# Terapkan migrasi (membaca drizzle/*.sql, idempotent via tabel _migrations).
~/.bun/bin/bun run db:migrate

# Seed data awal (roles, super admin, dsb.). Untuk data minimal:
~/.bun/bin/bun run db:seed
# atau data starter:
# ~/.bun/bin/bun run db:seed:starter
```

- `db:migrate` mencatat migrasi yang sudah dijalankan di tabel `_migrations`;
  aman dijalankan berulang. **Selalu** jalankan sebelum mengalihkan traffic ke
  versi baru.
- Endpoint `/ready` akan gagal (503) sampai tabel `auth_sessions` dan
  `media_assets` ada — jadi migrasi wajib sukses sebelum go-live.

---

## 9. Menjalankan Proses Produksi (systemd)

Gunakan systemd agar proses restart otomatis, punya log terpusat, dan hidup
setelah reboot. Ganti path Bun (`/opt/bomb/.bun/bin/bun`) dan direktori
(`/opt/bomb/api-services`) sesuai server Anda.

### 9.1 Service API — `/etc/systemd/system/bomb-api.service`

```ini
[Unit]
Description=Bomb Barbershop API (REST + Socket.IO)
After=network.target mysql.service redis-server.service
Wants=mysql.service redis-server.service

[Service]
Type=simple
User=bomb
Group=bomb
WorkingDirectory=/opt/bomb/api-services
Environment=NODE_ENV=production
Environment=PROCESS_ROLE=api
ExecStart=/opt/bomb/.bun/bin/bun run src/server.ts
Restart=always
RestartSec=3
# Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=false
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 9.2 Service Worker — `/etc/systemd/system/bomb-worker.service`

```ini
[Unit]
Description=Bomb Barbershop BullMQ Worker
After=network.target mysql.service redis-server.service
Wants=mysql.service redis-server.service

[Service]
Type=simple
User=bomb
Group=bomb
WorkingDirectory=/opt/bomb/api-services
Environment=NODE_ENV=production
Environment=PROCESS_ROLE=worker
ExecStart=/opt/bomb/.bun/bin/bun run src/worker.ts
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

### 9.3 Service Web — `/etc/systemd/system/bomb-web.service`

```ini
[Unit]
Description=Bomb Barbershop Backoffice Web
After=network.target
Wants=bomb-api.service

[Service]
Type=simple
User=bomb
Group=bomb
WorkingDirectory=/opt/bomb/api-services
Environment=NODE_ENV=production
Environment=PROCESS_ROLE=web
ExecStart=/opt/bomb/.bun/bin/bun run src/web/server.ts
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Aktifkan & jalankan:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bomb-api bomb-worker bomb-web
sudo systemctl status bomb-api bomb-worker bomb-web
# Log realtime:
sudo journalctl -u bomb-api -f
```

### 9.4 Alternatif: fullstack satu port

Jika memilih topologi B, ganti service `bomb-api` **dan** `bomb-web` dengan satu
service yang menjalankan `src/server-fullstack.ts` (tetap butuh `bomb-worker`):

```ini
ExecStart=/opt/bomb/.bun/bin/bun run src/server-fullstack.ts
# Port publik = PUBLIC_PORT || APP_PORT (default 3000); Socket tetap di SOCKET_PORT.
```

Prasyarat: build web dengan `VITE_API_BASE_URL` **kosong**, dan **jangan** set
`WEB_ASSET_MODE=dev`. Backoffice tersedia di `/backoffice/login`.

---

## 10. Reverse Proxy Nginx + TLS

Nginx menerima HTTPS publik lalu mem-*proxy* ke proses lokal. Yang krusial:
**Socket.IO** butuh *upgrade* WebSocket dan diarahkan ke `SOCKET_PORT` (3001).

### 10.1 Contoh untuk topologi split (dua subdomain)

`/etc/nginx/sites-available/bomb`:

```nginx
# ── API + Socket.IO ──────────────────────────────────────
server {
    listen 80;
    server_name api.domainanda.com;

    client_max_body_size 25m;   # sesuaikan dengan limit upload media

    # Socket.IO -> SOCKET_PORT (3001), butuh upgrade WebSocket
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    # REST API -> APP_PORT (3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# ── Backoffice web ───────────────────────────────────────
server {
    listen 80;
    server_name app.domainanda.com;

    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan + TLS:

```bash
sudo ln -s /etc/nginx/sites-available/bomb /etc/nginx/sites-enabled/bomb
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.domainanda.com -d app.domainanda.com
```

Certbot otomatis menambah blok `listen 443 ssl` + redirect 80→443. Karena Nginx
menulis `X-Forwarded-*`, pastikan `TRUST_PROXY=true` di `.env`.

> **Fullstack (topologi B):** cukup satu `server {}` dengan satu `server_name`;
> `location /` → `127.0.0.1:3000` dan `location /socket.io/` → `127.0.0.1:3001`.
> Sticky session tidak diperlukan bila `SOCKET_WEBSOCKET_ONLY=true`.

### 10.2 Scaling & sticky session

Socket.IO memakai Redis adapter, jadi broadcast bekerja lintas-instance. Namun
jika transport **polling** aktif (`SOCKET_WEBSOCKET_ONLY=false`) dan Anda punya
beberapa instance di belakang load balancer, **wajib** sticky session. Cara paling
mudah: `SOCKET_WEBSOCKET_ONLY=true` agar hanya WebSocket yang dipakai.

---

## 11. Verifikasi Setelah Deploy

```bash
# Liveness (proses hidup):
curl -fsS https://api.domainanda.com/health

# Readiness (Redis + DB + tabel auth_sessions & media_assets siap):
curl -fsS https://api.domainanda.com/ready
```

`/ready` harus mengembalikan `success: true`. Jika 503, cek field `data`
(`redis`, `database`, `auth_schema`, `media_schema`) untuk tahu komponen mana yang
belum siap — biasanya migrasi belum dijalankan atau Redis/DB tak terjangkau.

Cek juga:

- Backoffice: buka `https://app.domainanda.com` (split) atau
  `https://<domain>/backoffice/login` (fullstack).
- Worker: `sudo journalctl -u bomb-worker -f` → baris `BullMQ workers started`.

---

## 12. Prosedur Update / Redeploy

```bash
sudo -u bomb -H bash -l
cd /opt/bomb/api-services

git pull --ff-only
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run db:migrate     # SEBELUM restart, saat kode baru kompatibel
~/.bun/bin/bun run build:web      # jika ada perubahan frontend
exit

sudo systemctl restart bomb-api bomb-worker bomb-web
```

Urutan aman: **migrasi dulu** (aditif/kompatibel-mundur), lalu restart proses.
Untuk zero-downtime, jalankan beberapa instance API di port berbeda dan reload
Nginx bergiliran (blue-green) — di luar cakupan panduan dasar ini.

---

## 13. Backup, Log, Monitoring, Hardening

### Backup

- **MySQL** (harian, via cron):
  ```bash
  mysqldump --single-transaction --routines --triggers \
    -u bomb -p bun_bomb_barber | gzip > /var/backups/bomb-$(date +\%F).sql.gz
  ```
- **Media privat**: cadangkan direktori `storage/private/` dan `public/media/`
  (upload runtime, tidak ikut git).

### Log

- Log proses ada di journald: `journalctl -u bomb-api` (dan `-worker`, `-web`).
- Aplikasi memakai `pino`; atur `LOG_LEVEL`, dan opsional `LOG_PATH`/`LOG_ROTATE`
  untuk menulis ke file dengan rotasi (lihat variabel `LOG_*` di kode).

### Monitoring

- Uptime check ke `/health` (liveness) dan `/ready` (dependency).
- Pantau memori/CPU proses Bun dan koneksi MySQL/Redis.

### Hardening

- Firewall (`ufw`): buka hanya 80/443 (+ 22 SSH). Port 3000/3001/5174 cukup di
  `127.0.0.1` — **jangan** ekspos langsung ke internet; akses lewat Nginx.
  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 'Nginx Full'
  sudo ufw enable
  ```
- Redis & MySQL bind ke localhost / jaringan privat, pakai password kuat.
- Perbarui `JWT_*`, `MEDIA_SIGN_SECRET`, kredensial DB secara berkala.

---

## 14. Troubleshooting

| Gejala | Kemungkinan penyebab & solusi |
|--------|-------------------------------|
| Boot gagal: *"CORS_ORIGINS wajib dikonfigurasi"* | Isi `CORS_ORIGINS` di `.env` (produksi). |
| Boot gagal: JWT secret lemah/kosong | Set `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` acak ≥ 32 char. |
| Boot gagal: *"Env database belum di-set"* | Isi `DATABASE_URL` **atau** `DATABASE_SERVER` + `DATABASE_NAME`. |
| `/ready` 503, `database:false` | MySQL tak terjangkau / kredensial salah / migrasi belum jalan. |
| `/ready` 503, `auth_schema` atau `media_schema` false | Jalankan `bun run db:migrate`. |
| `/ready` 503, `redis:false` | Redis mati atau `REDIS_URL` salah. |
| Socket.IO tak konek dari browser | Blok `location /socket.io/` di Nginx belum ada / tanpa header Upgrade. |
| Job (timeout/no-show/reminder) tak jalan | `bomb-worker` mati, atau `RUN_WORKERS_IN_PROCESS` masih `true` (double-process). |
| Rate-limit login mudah di-bypass | `TRUST_PROXY` tidak sesuai — set `true` HANYA di belakang proxy tepercaya. |
| Backoffice memanggil API salah origin | Rebuild `bun run build:web` dengan `VITE_API_BASE_URL` yang benar. |
| Upload media gagal / 413 | Naikkan `client_max_body_size` di Nginx dan cek `MEDIA_MAX_*`. |

---

### Ringkasan perintah cepat

```bash
# Setup awal
bun install --frozen-lockfile
bun run db:migrate && bun run db:seed
bun run build:web

# Produksi (via systemd)
sudo systemctl enable --now bomb-api bomb-worker bomb-web

# Verifikasi
curl -fsS https://api.domainanda.com/ready
```
