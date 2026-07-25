import pino from 'pino';
import * as rfs from 'rotating-file-stream';
import { join } from 'path';
import { mkdirSync } from 'fs';

const logLevel = process.env.LOG_LEVEL || 'info';

const logsPath = join(process.cwd(), 'logs');
mkdirSync(logsPath, { recursive: true });

if (process.env.LOG_ROTATE === '1' || process.env.LOG_ROTATE === 'true') {
  const interval = process.env.LOG_ROTATE_INTERVAL || '1d';
  const compress = process.env.LOG_ROTATE_COMPRESS || 'gzip';

  const generator = (time: Date | null, _index: number) => {
    if (!time) return 'app.log';
    const date = time.toISOString().slice(0, 10);
    return `${date}-app.log`;
  };

  var destination: any = (rfs as any).createStream(generator, {
    interval,
    compress,
    path: logsPath,
  });
} else {
  var destination: any = pino.destination({
    dest: join(logsPath, 'app.log'),
    mkdir: true,
    sync: false
  });
}

const pinoOptions: any = { level: logLevel };

export const logger = pino(pinoOptions, destination);

let processErrorHandlersRegistered = false;

export function registerProcessErrorHandlers(context = 'process') {
  if (processErrorHandlersRegistered) return;
  processErrorHandlersRegistered = true;

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason, context }, '[Process] Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err, context }, '[Process] Uncaught exception');
    logger.flush?.();
    setTimeout(() => process.exit(1), 100).unref?.();
  });
}

export default logger;
