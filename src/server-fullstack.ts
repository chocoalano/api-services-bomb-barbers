import './boot'; // validasi env sebelum modul lain dievaluasi
import { staticPlugin } from '@elysiajs/static';
import { app } from './app';
import { webRoutes } from './web/routes';
import { logger, registerProcessErrorHandlers } from './lib/logger';
import { closeSocketServer, startSocketServer } from './lib/socket';
import {
  redis,
  appRedis,
  socketPubClient,
  socketSubClient
} from './lib/redis';
import { stopQueueInfrastructure } from './lib/queue';

registerProcessErrorHandlers('fullstack-server');

/**
 * Server "fullstack" satu port: menyajikan API, aset build, dan halaman Inertia
 * backoffice dari origin yang sama. Dirancang agar bisa diekspos lewat SATU tunnel
 * (mis. ngrok) sehingga `api` dan `web` dapat diakses dari satu link.
 *
 * Prasyarat:
 *   1. Frontend sudah di-build (`bun run build:web`) dengan VITE_API_BASE_URL kosong
 *      (lihat .env.production) agar panggilan API bersifat same-origin/relatif.
 *   2. JANGAN set WEB_ASSET_MODE=dev — renderer harus menyajikan aset dari /build,
 *      bukan dari Vite dev server (:5173) yang tidak ikut ter-tunnel.
 */

// Menyajikan aset hasil build Vite di /build (app.ts sudah menyajikan /public).
app
  .use(staticPlugin({ assets: 'public/build', prefix: '/build' }))
  .use(webRoutes);

const PORT = Number(process.env.PUBLIC_PORT || process.env.APP_PORT || 3000);
const SOCKET_PORT = Number(process.env.SOCKET_PORT || 3001);

if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error('PUBLIC_PORT/APP_PORT wajib berupa port yang valid.');
}
if (process.env.WEB_ASSET_MODE === 'dev') {
  logger.warn(
    'WEB_ASSET_MODE=dev terdeteksi pada server fullstack. Aset akan menunjuk ke Vite (:5173) ' +
    'yang tidak ter-tunnel — halaman tidak akan termuat via ngrok. Hapus flag ini.'
  );
}

startSocketServer(SOCKET_PORT);
logger.info({ port: SOCKET_PORT }, 'Socket.IO server started');

app.listen(PORT);
logger.info({ port: PORT }, 'Fullstack server (API + Web + assets) started on a single port');
logger.info({ url: `http://localhost:${PORT}/backoffice/login` }, 'Backoffice ready');

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out');
    process.exit(1);
  }, 15000);
  forceExit.unref();

  try {
    await Promise.allSettled([closeSocketServer(), stopQueueInfrastructure()]);
    await (app as any).stop?.();
    await Promise.allSettled([
      socketSubClient.quit(),
      socketPubClient.quit(),
      appRedis.quit(),
      redis.quit()
    ]);
    clearTimeout(forceExit);
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Graceful shutdown failed');
    process.exit(1);
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
