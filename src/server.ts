import { app } from './app';
import { logger } from './lib/logger';
import { closeSocketServer, startSocketServer } from './lib/socket';
import {
  redis,
  socketPubClient,
  socketSubClient
} from './lib/redis';
import { stopQueueInfrastructure } from './lib/queue';

const PORT = Number(process.env.APP_PORT || 3000);
const SOCKET_PORT = Number(process.env.SOCKET_PORT || 3001);

if (!Number.isInteger(PORT) || PORT <= 0 || !Number.isInteger(SOCKET_PORT) || SOCKET_PORT <= 0) {
  throw new Error('APP_PORT dan SOCKET_PORT wajib berupa port yang valid.');
}
if (PORT === SOCKET_PORT) {
  throw new Error('APP_PORT dan SOCKET_PORT harus menggunakan port yang berbeda.');
}

startSocketServer(SOCKET_PORT);
logger.info({ port: SOCKET_PORT }, 'Socket.IO server started');

const listener = app.listen(PORT);
if (listener && typeof (listener as any).then === 'function') {
  (listener as any)
    .then(() => {
      logger.info({ port: PORT }, 'Elysia REST API started');
      logger.info({ url: `http://localhost:${PORT}/docs` }, 'Swagger UI available');
    })
    .catch((err: any) => {
      logger.error({ err }, 'Failed to start REST API');
      process.exit(1);
    });
} else {
  logger.info({ port: PORT }, 'Elysia REST API started');
  logger.info({ url: `http://localhost:${PORT}/docs` }, 'Swagger UI available');
}

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
    await Promise.allSettled([
      closeSocketServer(),
      stopQueueInfrastructure()
    ]);
    await (app as any).stop?.();
    await Promise.allSettled([
      socketSubClient.quit(),
      socketPubClient.quit(),
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
