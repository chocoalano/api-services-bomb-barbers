import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBarber } from '../../../middleware/rbac';
import { BarberMediaController } from './controller';
import { mediaDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const barberMediaRoutes = new Elysia()
  .use(staffAuthMiddleware)
  .onBeforeHandle(requireBarber)
  // ── Canonical: /api/v1/barbers/media ──────────────────────────────────────
  .post('/api/v1/barbers/media/upload', BarberMediaController.upload, mediaDocs.upload)
  .get('/api/v1/barbers/media/:id/url', BarberMediaController.getSignedUrl, mediaDocs.getSignedUrl)
  .delete('/api/v1/barbers/media/:id', BarberMediaController.remove, mediaDocs.remove)
  // ── Deprecated: /api/v1/barber/media → /api/v1/barbers/media ─────────────
  .post('/api/v1/barber/media/upload', deprecated('/api/v1/barbers/media/upload', BarberMediaController.upload), deprecatedDetail)
  .get('/api/v1/barber/media/:id/url', deprecated('/api/v1/barbers/media/:id/url', BarberMediaController.getSignedUrl), deprecatedDetail)
  .delete('/api/v1/barber/media/:id', deprecated('/api/v1/barbers/media/:id', BarberMediaController.remove), deprecatedDetail);
