import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { logger, registerProcessErrorHandlers } from '../lib/logger';
import { webRoutes } from './routes';

registerProcessErrorHandlers('web-server');

const WEB_PORT = Number(process.env.WEB_PORT || 5174);

if (!Number.isInteger(WEB_PORT) || WEB_PORT <= 0) {
  throw new Error('WEB_PORT wajib berupa port yang valid.');
}

const app = new Elysia()
  .use(staticPlugin({ assets: 'public', prefix: '/public' }))
  .use(staticPlugin({ assets: 'public/build', prefix: '/build' }))
  .use(webRoutes)
  .onError(({ code, error, set }) => {
    set.status = code === 'NOT_FOUND' ? 404 : 500;

    if (code !== 'NOT_FOUND') {
      logger.error({ err: error }, '[WebServer] Unhandled error');
    } else {
      logger.warn({ code }, '[WebServer] Page not found');
    }

    return {
      success: false,
      message: code === 'NOT_FOUND' ? 'Halaman tidak ditemukan' : 'Web layer gagal memproses request',
      data: null
    };
  });

const listener = app.listen(WEB_PORT);

if (listener && typeof (listener as any).then === 'function') {
  (listener as any)
    .then(() => logger.info({ port: WEB_PORT }, 'Bomb Barbershop web layer started'))
    .catch((err: unknown) => {
      logger.error({ err }, 'Failed to start Bomb Barbershop web layer');
      process.exit(1);
    });
} else {
  logger.info({ port: WEB_PORT }, 'Bomb Barbershop web layer started');
}
