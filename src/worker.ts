import { logger } from './lib/logger';
import { redis, socketPubClient, socketSubClient } from './lib/redis';
import { startQueueWorkers, stopQueueInfrastructure } from './lib/queue';

startQueueWorkers();
logger.info('BullMQ workers started');

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Worker shutdown started');

  await stopQueueInfrastructure();
  await Promise.allSettled([
    socketSubClient.quit(),
    socketPubClient.quit(),
    redis.quit()
  ]);
  logger.info('Worker shutdown completed');
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
