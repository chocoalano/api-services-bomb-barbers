import { Elysia } from 'elysia';
import { logger } from '../lib/logger';

// Logging request/latency terstruktur untuk observability produksi (HB5).
// Waktu mulai disimpan per-request via WeakMap (auto-cleanup, aman untuk konkurensi).
const startTimes = new WeakMap<Request, number>();

export const requestLogger = new Elysia({ name: 'request-logger' })
  .onRequest(({ request }) => {
    startTimes.set(request, Date.now());
  })
  .onAfterResponse(({ request, path, set }) => {
    const start = startTimes.get(request);
    startTimes.delete(request);
    const rawStatus = set.status ?? 200;
    const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
    const payload = {
      method: request.method,
      path,
      status: Number.isFinite(status) ? status : 200,
      durationMs: start !== undefined ? Date.now() - start : undefined
    };

    if (payload.status >= 500) {
      logger.error(payload, 'request failed');
      return;
    }
    if (payload.status >= 400) {
      logger.warn(payload, 'request failed');
      return;
    }
    logger.info(payload, 'request');
  })
  .as('global');
