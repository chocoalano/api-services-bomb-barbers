# Deployment Step-by-Step (Tanpa Docker)

Runbook berurutan dari server kosong (Ubuntu 22.04/24.04) sampai aplikasi live.
Ikuti dari atas ke bawah. Referensi lengkap ada di [DEPLOYMENT.md](DEPLOYMENT.md).

Ganti nilai berikut sesuai punya Anda:
- Domain API : `api.domainanda.com`
- Domain app : `app.domainanda.com`
- Password DB : `PASSWORD_DB_KUAT`
- URL repo : `<URL_REPO>`

---

## Langkah 1 — Login server & update sistem

```bash
ssh root@IP_SERVER
apt update && apt upgrade -y
apt install -y curl git unzip build-essential ca-certificates
```

## Langkah 2 — Pasang MySQL, Redis, Nginx

```bash
apt install -y mysql-server redis-server nginx
systemctl enable --now mysql redis-server nginx
redis-cli ping        # harus balas: PONG
```

## Langkah 3 — Buat user aplikasi (non-root)

```bash
adduser --system --group --home /opt/bomb bomb
```

## Langkah 4 — Pasang Bun untuk user `bomb`

```bash
sudo -u bomb -H bash -lc 'curl -fsSL https://bun.sh/install | bash'
sudo -u bomb -H bash -lc '~/.bun/bin/bun --version'   # harus >= 1.3.10
```

Bun sekarang ada di: `/opt/bomb/.bun/bin/bun` (dipakai di langkah systemd).

## Langkah 5 — Buat database & user MySQL

```bash
mysql -u root -p
```

Di prompt MySQL, jalankan:

```sql
CREATE DATABASE bun_bomb_barber CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bomb'@'localhost' IDENTIFIED BY 'PASSWORD_DB_KUAT';
GRANT ALL PRIVILEGES ON bun_bomb_barber.* TO 'bomb'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## Langkah 6 — Ambil kode & install dependensi

```bash
sudo -u bomb -H bash -l          # masuk sebagai user bomb
cd /opt/bomb
git clone <URL_REPO> api-services
cd api-services
~/.bun/bin/bun install --frozen-lockfile
```

## Langkah 7 — Buat file `.env`

Buat file `/opt/bomb/api-services/.env` (masih sebagai user `bomb`):

```bash
nano .env
```

Isi minimal untuk produksi (generate secret dengan `openssl rand -hex 32`):

```env
NODE_ENV=production
APP_PORT=3000
SOCKET_PORT=3001
WEB_PORT=5174

# Database — boleh URL utuh ATAU bagian terpisah (pilih satu)
DATABASE_URL=mysql://bomb:PASSWORD_DB_KUAT@localhost:3306/bun_bomb_barber

REDIS_URL=redis://127.0.0.1:6379

# Worker jalan sebagai proses terpisah
RUN_WORKERS_IN_PROCESS=false

# WAJIB: acak, min 32 char, dan BERBEDA satu sama lain
JWT_ACCESS_SECRET=GANTI_openssl_rand_hex_32
JWT_REFRESH_SECRET=GANTI_openssl_rand_hex_32_LAIN

# WAJIB di produksi: origin frontend yang diizinkan
CORS_ORIGINS=https://app.domainanda.com
SOCKET_CORS_ORIGINS=https://app.domainanda.com
SOCKET_WEBSOCKET_ONLY=true

# true karena di belakang Nginx
TRUST_PROXY=true

# Media
MEDIA_BASE_URL=https://api.domainanda.com

# Payment (isi sesuai akun; boleh dikosongkan dulu)
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_PRODUCTION=false
```

Simpan (`Ctrl+O`, `Enter`, `Ctrl+X`).

## Langkah 8 — Migrasi & seed database

```bash
~/.bun/bin/bun run db:migrate
~/.bun/bin/bun run db:seed
```

## Langkah 9 — Build frontend backoffice

```bash
~/.bun/bin/bun run build:web      # hasil -> public/build/
exit                              # keluar dari user bomb, kembali ke root/sudo
```

> Catatan: contoh ini memakai domain API terpisah (`api.domainanda.com`). Bila
> `VITE_API_BASE_URL` perlu diisi, set di `.env` **sebelum** build lalu ulangi
> `build:web`. Untuk satu-domain (fullstack), biarkan kosong.

## Langkah 10 — Buat 3 service systemd

**API** — `/etc/systemd/system/bomb-api.service`:

```ini
[Unit]
Description=Bomb API (REST + Socket.IO)
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
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

**Worker** — `/etc/systemd/system/bomb-worker.service`:

```ini
[Unit]
Description=Bomb BullMQ Worker
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

[Install]
WantedBy=multi-user.target
```

**Web** — `/etc/systemd/system/bomb-web.service`:

```ini
[Unit]
Description=Bomb Backoffice Web
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

[Install]
WantedBy=multi-user.target
```

## Langkah 11 — Jalankan ketiga service

```bash
systemctl daemon-reload
systemctl enable --now bomb-api bomb-worker bomb-web
systemctl status bomb-api bomb-worker bomb-web --no-pager
```

Cek log jika ada yang gagal:

```bash
journalctl -u bomb-api -n 50 --no-pager
```

## Langkah 12 — Konfigurasi Nginx

Buat `/etc/nginx/sites-available/bomb`:

```nginx
# API + Socket.IO
server {
    listen 80;
    server_name api.domainanda.com;
    client_max_body_size 25m;

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

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Backoffice
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

Aktifkan:

```bash
ln -s /etc/nginx/sites-available/bomb /etc/nginx/sites-enabled/bomb
nginx -t
systemctl reload nginx
```

## Langkah 13 — Pasang HTTPS (TLS)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.domainanda.com -d app.domainanda.com
```

Certbot otomatis mengaktifkan port 443 dan redirect 80→443.

## Langkah 14 — Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

## Langkah 15 — Verifikasi live

```bash
curl -fsS https://api.domainanda.com/health     # server hidup
curl -fsS https://api.domainanda.com/ready       # semua dependency siap (success: true)
```

Lalu buka `https://app.domainanda.com` di browser → halaman login backoffice.

Jika `/ready` mengembalikan 503, lihat field `data` di responsnya:
`redis`, `database`, `auth_schema`, `media_schema` — komponen yang `false` adalah
sumber masalah (umumnya migrasi belum jalan atau Redis/DB tak terjangkau).

---

## Cara update versi baru (nanti)

```bash
sudo -u bomb -H bash -l
cd /opt/bomb/api-services
git pull --ff-only
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run db:migrate
~/.bun/bin/bun run build:web
exit
systemctl restart bomb-api bomb-worker bomb-web
```

---

## Ringkasan urutan

1. Update sistem
2. Pasang MySQL, Redis, Nginx
3. Buat user `bomb`
4. Pasang Bun
5. Buat DB + user MySQL
6. Clone kode + `bun install`
7. Buat `.env`
8. `db:migrate` + `db:seed`
9. `build:web`
10. Buat 3 unit systemd
11. `systemctl enable --now`
12. Konfigurasi Nginx
13. TLS via Certbot
14. Firewall
15. Verifikasi `/ready`
