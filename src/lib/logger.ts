import pino from 'pino';
import * as rfs from 'rotating-file-stream';
import { join } from 'path';

const pretty = process.env.NODE_ENV !== 'production';

const logLevel = process.env.LOG_LEVEL || 'info';

let destination: any = undefined;

if (process.env.LOG_ROTATE === '1' || process.env.LOG_ROTATE === 'true') {
  const logsPath = process.env.LOG_PATH || join(process.cwd(), 'logs');
  const interval = process.env.LOG_ROTATE_INTERVAL || '1d';
  const compress = process.env.LOG_ROTATE_COMPRESS || 'gzip';

  const generator = (time: Date | null, index: number) => {
    if (!time) return 'app.log';
    const date = time.toISOString().slice(0, 10);
    return `${date}-app.log`;
  };

  const stream = (rfs as any).createStream(generator, {
    interval,
    compress,
    path: logsPath,
  });

  destination = stream;
}

const pinoOptions: any = { level: logLevel };

// If rotating to file, prefer writing directly to the destination stream.
// Do not set `transport` in that case because transport can override destination.
if (pretty && !destination) {
  pinoOptions.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = destination ? pino(pinoOptions, destination) : pino(pinoOptions);

export default logger;
