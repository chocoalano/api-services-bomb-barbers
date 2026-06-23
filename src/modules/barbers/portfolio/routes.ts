import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { BarberPortfolioController } from './controller';
import { portfolioDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const barberPortfolioRoutes = new Elysia()
  .use(staffAuthMiddleware)
  // ── Canonical: /api/v1/barbers/portfolio ──────────────────────────────────
  .post('/api/v1/barbers/portfolio', BarberPortfolioController.upload, portfolioDocs.upload)
  .get('/api/v1/barbers/portfolio', BarberPortfolioController.list, portfolioDocs.list)
  .delete('/api/v1/barbers/portfolio/:id', BarberPortfolioController.remove, portfolioDocs.remove)
  // ── Deprecated: /api/v1/barber/portfolio → /api/v1/barbers/portfolio ──────
  .post('/api/v1/barber/portfolio', deprecated('/api/v1/barbers/portfolio', BarberPortfolioController.upload), deprecatedDetail)
  .get('/api/v1/barber/portfolio', deprecated('/api/v1/barbers/portfolio', BarberPortfolioController.list), deprecatedDetail)
  .delete('/api/v1/barber/portfolio/:id', deprecated('/api/v1/barbers/portfolio/:id', BarberPortfolioController.remove), deprecatedDetail);
