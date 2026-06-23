import { Elysia } from 'elysia';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { CustomerMediaController } from './controller';
import { mediaDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const customerMediaRoutes = new Elysia()
  // ── Canonical: /api/v1/customers/media ────────────────────────────────────
  .group('/api/v1/customers/media', (app) => app
    .use(customerAuthMiddleware)
    .post('/upload', CustomerMediaController.upload, mediaDocs.upload)
    .get('/:id/url', CustomerMediaController.getSignedUrl, mediaDocs.getSignedUrl)
    .delete('/:id', CustomerMediaController.remove, mediaDocs.remove)
  )
  // ── Deprecated: /api/v1/customer/media → /api/v1/customers/media ──────────
  .group('/api/v1/customer/media', (app) => app
    .use(customerAuthMiddleware)
    .post('/upload', deprecated('/api/v1/customers/media/upload', CustomerMediaController.upload), deprecatedDetail)
    .get('/:id/url', deprecated('/api/v1/customers/media/:id/url', CustomerMediaController.getSignedUrl), deprecatedDetail)
    .delete('/:id', deprecated('/api/v1/customers/media/:id', CustomerMediaController.remove), deprecatedDetail)
  )
  // ── Deprecated: /api/v1/media/upload → /api/v1/customers/media/upload ─────
  .group('/api/v1/media', (app) => app
    .use(customerAuthMiddleware)
    .post('/upload', deprecated('/api/v1/customers/media/upload', CustomerMediaController.upload), deprecatedDetail)
  );
