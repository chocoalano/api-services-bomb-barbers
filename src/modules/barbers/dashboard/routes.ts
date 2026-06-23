import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBarber } from '../../../middleware/rbac';
import { DashboardController } from './controller';
import { dashboardDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const barberDashboardRoutes = new Elysia({ prefix: '/api/v1' })
  .use(staffAuthMiddleware)
  // ── Canonical: /api/v1/barbers ────────────────────────────────────────────
  .group('/barbers', (app) => app
    .onBeforeHandle(requireBarber)
    .get('/dashboard/today', DashboardController.getBarberToday, dashboardDocs.barberToday)
    .get('/stats/daily', DashboardController.getBarberStats, dashboardDocs.barberStats)
    .get('/earnings', DashboardController.getBarberStats, dashboardDocs.barberEarnings)
  )
  // ── Deprecated: /api/v1/barber → /api/v1/barbers ─────────────────────────
  .group('/barber', (app) => app
    .onBeforeHandle(requireBarber)
    .get('/dashboard/today', deprecated('/api/v1/barbers/dashboard/today', DashboardController.getBarberToday), deprecatedDetail)
    .get('/stats/daily', deprecated('/api/v1/barbers/stats/daily', DashboardController.getBarberStats), deprecatedDetail)
    .get('/earnings', deprecated('/api/v1/barbers/earnings', DashboardController.getBarberStats), deprecatedDetail)
  )
  // ── Deprecated: /api/v1/staff → /api/v1/barbers ──────────────────────────
  .group('/staff', (app) => app
    .onBeforeHandle(requireBarber)
    .get('/dashboard/today', deprecated('/api/v1/barbers/dashboard/today', DashboardController.getBarberToday), deprecatedDetail)
    .get('/stats/daily', deprecated('/api/v1/barbers/stats/daily', DashboardController.getBarberStats), deprecatedDetail)
    .get('/earnings', deprecated('/api/v1/barbers/earnings', DashboardController.getBarberStats), deprecatedDetail)
  );
