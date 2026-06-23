import { Elysia } from 'elysia';
import { setupAuth, staffAuthMiddleware } from '../../../middleware/auth';
import { StaffAuthController } from './controller';
import { barberAuthDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

// ── Canonical: /api/v1/barbers ────────────────────────────────────────────
const canonicalBarberAuth = new Elysia({ prefix: '/api/v1/barbers' })
  .use(setupAuth)
  .group('/auth', (authApp: any) => authApp
    .post('/login', StaffAuthController.login, barberAuthDocs.login)
    .post('/refresh', StaffAuthController.refresh, barberAuthDocs.refresh)
    .post('/logout', StaffAuthController.logout, barberAuthDocs.logout)
  )
  .use(staffAuthMiddleware)
  .get('/me', StaffAuthController.getProfile, barberAuthDocs.getProfile);

// ── Deprecated: /api/v1/barber → /api/v1/barbers ─────────────────────────
const deprecatedBarberAuth = new Elysia({ prefix: '/api/v1/barber' })
  .use(setupAuth)
  .group('/auth', (authApp: any) => authApp
    .post('/login', deprecated('/api/v1/barbers/auth/login', StaffAuthController.login), deprecatedDetail)
    .post('/refresh', deprecated('/api/v1/barbers/auth/refresh', StaffAuthController.refresh), deprecatedDetail)
    .post('/logout', deprecated('/api/v1/barbers/auth/logout', StaffAuthController.logout), deprecatedDetail)
  )
  .use(staffAuthMiddleware)
  .get('/me', deprecated('/api/v1/barbers/me', StaffAuthController.getProfile), deprecatedDetail);

// ── Deprecated: /api/v1/staff → /api/v1/barbers ──────────────────────────
const deprecatedStaffAuth = new Elysia({ prefix: '/api/v1/staff' })
  .use(setupAuth)
  .group('/auth', (authApp: any) => authApp
    .post('/login', deprecated('/api/v1/barbers/auth/login', StaffAuthController.login), deprecatedDetail)
    .post('/refresh', deprecated('/api/v1/barbers/auth/refresh', StaffAuthController.refresh), deprecatedDetail)
    .post('/logout', deprecated('/api/v1/barbers/auth/logout', StaffAuthController.logout), deprecatedDetail)
  )
  .use(staffAuthMiddleware)
  .get('/me', deprecated('/api/v1/barbers/me', StaffAuthController.getProfile), deprecatedDetail);

export const barberAuthRoutes = new Elysia()
  .use(canonicalBarberAuth)
  .use(deprecatedBarberAuth)
  .use(deprecatedStaffAuth);
