import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { staticPlugin } from "@elysiajs/static";
import { errorHandler } from "./middleware/error-handler";
import { createSuccessResponse } from "./shared/response";
import { logger } from "./lib/logger";

import { adminRoutes } from "./modules/admin/routes";
import { barberRoutes } from "./modules/barbers/routes";
import { customerRoutes } from "./modules/customers/routes";
import { ADMIN_TAGS } from "./modules/admin/swagger";
import { CUSTOMER_TAGS } from "./modules/customers/swagger";
import { BARBER_TAGS } from "./modules/barbers/swagger";
import { redis } from "./lib/redis";
import { supabase } from "./lib/supabase";

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS wajib dikonfigurasi pada environment production.');
}

export const app = new Elysia()
  .use(cors({
    origin: corsOrigins.length > 0
      ? corsOrigins
      : ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true
  }))
  .use(staticPlugin({ assets: "public", prefix: "/public" }))
  .use(errorHandler)
  .use(swagger({
    path: "/docs",
    documentation: {
      info: {
        title: "Bomb Barbershop API",
        version: "1.0.0",
        description: "REST API operasional Bomb Barbershop. Endpoint dikelompokkan berdasarkan pengguna dan domain, dengan dokumentasi parameter, request, response sukses, serta response error."
      },
      tags: [
        { name: CUSTOMER_TAGS.auth, description: "Registrasi, login, refresh token, dan logout pelanggan." },
        { name: CUSTOMER_TAGS.profile, description: "Profil pelanggan yang sedang terautentikasi." },
        { name: CUSTOMER_TAGS.catalog, description: "Daftar cabang, barber, layanan, dan harga yang digunakan aplikasi pelanggan." },
        { name: CUSTOMER_TAGS.availability, description: "Perhitungan slot booking yang tersedia berdasarkan cabang, layanan, barber, dan tanggal." },
        { name: CUSTOMER_TAGS.appointments, description: "Pembuatan dan pengelolaan appointment milik pelanggan." },
        { name: CUSTOMER_TAGS.tracking, description: "Consent tracking, ETA perjalanan, lokasi realtime, dan check-in pelanggan." },
        { name: CUSTOMER_TAGS.payments, description: "Inisiasi pembayaran, detail pembayaran, dan nota pelanggan." },
        { name: CUSTOMER_TAGS.chat, description: "Riwayat dan pengiriman pesan chat pada appointment pelanggan." },
        { name: CUSTOMER_TAGS.reviews, description: "Rating dan ulasan pelanggan setelah layanan selesai." },
        { name: CUSTOMER_TAGS.content, description: "Banner, galeri hasil layanan, serta notifikasi aplikasi pelanggan." },
        { name: CUSTOMER_TAGS.media, description: "Upload foto referensi pelanggan untuk booking dan ulasan." },
        { name: BARBER_TAGS.auth, description: "Login, refresh token, dan logout barber melalui akun staff." },
        { name: BARBER_TAGS.profile, description: "Profil staff dan profil operasional barber yang sedang login." },
        { name: BARBER_TAGS.queue, description: "Antrean serta order aktif yang ditugaskan kepada barber." },
        { name: BARBER_TAGS.appointments, description: "Penerimaan order dan perubahan lifecycle pelayanan barber." },
        { name: BARBER_TAGS.tracking, description: "Pengiriman lokasi GPS dan ETA barber secara realtime." },
        { name: BARBER_TAGS.dashboard, description: "Ringkasan kinerja, current order, statistik, dan pendapatan barber." },
        { name: BARBER_TAGS.commissions, description: "Riwayat komisi harian milik barber." },
        { name: BARBER_TAGS.chat, description: "Riwayat dan pengiriman pesan barber pada appointment." },
        { name: BARBER_TAGS.media, description: "Upload media referensi atau dokumentasi layanan oleh barber." },
        { name: BARBER_TAGS.portfolio, description: "Upload, daftar, dan penghapusan portfolio hasil kerja barber." },
        { name: ADMIN_TAGS.auth, description: "Login, refresh token, logout, dan profil admin." },
        { name: ADMIN_TAGS.rbac, description: "Manajemen role, permission, dan assignment role staff." },
        { name: ADMIN_TAGS.branches, description: "Master data cabang Bomb Barbershop." },
        { name: ADMIN_TAGS.barbers, description: "Master data dan penempatan barber." },
        { name: ADMIN_TAGS.services, description: "Master data layanan barbershop." },
        { name: ADMIN_TAGS.prices, description: "Harga layanan berdasarkan cabang, region, atau harga global." },
        { name: ADMIN_TAGS.appointments, description: "Walk-in, antrean cabang, dan perubahan status appointment." },
        { name: ADMIN_TAGS.payments, description: "Pencatatan dan pembacaan transaksi pembayaran." },
        { name: ADMIN_TAGS.webhooks, description: "Callback payment gateway Midtrans dan Xendit." },
        { name: ADMIN_TAGS.audit, description: "Rekam jejak perubahan penting dan transaksi finansial." },
        { name: ADMIN_TAGS.commissions, description: "Kalkulasi dan laporan komisi barber/cabang." },
        { name: ADMIN_TAGS.dashboard, description: "Dashboard operasional per cabang." },
        { name: ADMIN_TAGS.hqDashboard, description: "Dashboard konsolidasi seluruh cabang untuk HQ." },
        { name: ADMIN_TAGS.expenses, description: "Pencatatan dan pengelolaan pengeluaran cabang." },
        { name: ADMIN_TAGS.queue, description: "Streaming antrean aktif cabang melalui SSE." },
        { name: ADMIN_TAGS.analytics, description: "Analytics dan export laporan tingkat HQ." },
        { name: ADMIN_TAGS.media, description: "Upload media untuk banner, layanan, cabang, dan konten HQ." }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Masukkan JWT access token sesuai kelompok endpoint (customer, staff/admin, atau barber) tanpa menambahkan kata Bearer secara manual."
          }
        }
      }
    }
  }))
  .get("/health", () => createSuccessResponse("Server is healthy", null))
  .get("/ready", async ({ set }) => {
    const [redisResult, databaseResult, authSchemaResult, mediaSchemaResult] = await Promise.allSettled([
      redis.ping(),
      supabase.from('branches').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('auth_sessions' as any).select('id').limit(1),
      supabase.from('media_assets' as any).select('id').limit(1)
    ]);
    const redisReady = redisResult.status === 'fulfilled' && redisResult.value === 'PONG';
    const databaseReady =
      databaseResult.status === 'fulfilled' &&
      !databaseResult.value.error;
    const authSchemaReady =
      authSchemaResult.status === 'fulfilled' &&
      !authSchemaResult.value.error;
    const mediaSchemaReady =
      mediaSchemaResult.status === 'fulfilled' &&
      !mediaSchemaResult.value.error;

    if (!redisReady || !databaseReady || !authSchemaReady || !mediaSchemaReady) {
      set.status = 503;
      return {
        success: false,
        message: 'Service belum siap menerima traffic',
        data: {
          redis: redisReady,
          database: databaseReady,
          auth_schema: authSchemaReady,
          media_schema: mediaSchemaReady
        },
        errors: null,
        meta: null
      };
    }

    return createSuccessResponse("Service siap menerima traffic", {
      redis: true,
      database: true,
      auth_schema: true,
      media_schema: true
    });
  })
  .get("/", () => createSuccessResponse("Welcome to Bomb Barbershop API", null))
  .group("/api/v1", (api) =>
    api
      .get("/health", () => createSuccessResponse("API V1 is healthy", null))
  );

// Mount router berdasarkan domain agar ownership endpoint mudah diaudit.
const modulesToMount: Array<[string, any]> = [
  ['customerRoutes', customerRoutes],
  ['adminRoutes', adminRoutes],
  ['barberRoutes', barberRoutes],
];

for (const [name, mod] of modulesToMount) {
  try {
    app.use(mod);
    logger.info({ module: name }, `Mounted ${name}`);
  } catch (err) {
    logger.error({ module: name, err }, `Failed to mount ${name}`);
  }
}
