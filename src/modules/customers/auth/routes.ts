import { Elysia } from 'elysia';
import { setupAuth, customerAuthMiddleware } from '../../../middleware/auth';
import { CustomerAuthController } from './controller';
import { customerAuthDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

// ── Canonical: /api/v1/customers ───────────────────────────────────────────
const canonicalAuthRoutes = new Elysia({ prefix: '/api/v1/customers' })
  .use(setupAuth)
  .group('/auth', (app) =>
    app
      .post('/register', CustomerAuthController.register, customerAuthDocs.register)
      .post('/login', CustomerAuthController.login, customerAuthDocs.login)
      .post('/refresh', CustomerAuthController.refresh, customerAuthDocs.refresh)
      .post('/logout', CustomerAuthController.logout, customerAuthDocs.logout)
  )
  .use(customerAuthMiddleware)
  .get('/me', CustomerAuthController.getProfile, customerAuthDocs.getProfile)
  .patch('/me', CustomerAuthController.updateProfile);

// ── Deprecated: /api/v1/customer → /api/v1/customers ──────────────────────
const deprecatedAuthRoutes = new Elysia({ prefix: '/api/v1/customer' })
  .use(setupAuth)
  .group('/auth', (app) =>
    app
      .post('/register', deprecated('/api/v1/customers/auth/register', CustomerAuthController.register), deprecatedDetail)
      .post('/login', deprecated('/api/v1/customers/auth/login', CustomerAuthController.login), deprecatedDetail)
      .post('/refresh', deprecated('/api/v1/customers/auth/refresh', CustomerAuthController.refresh), deprecatedDetail)
      .post('/logout', deprecated('/api/v1/customers/auth/logout', CustomerAuthController.logout), deprecatedDetail)
  )
  .use(customerAuthMiddleware)
  .get('/me', deprecated('/api/v1/customers/me', CustomerAuthController.getProfile), deprecatedDetail);

export const customerAuthRoutes = new Elysia()
  .use(canonicalAuthRoutes)
  .use(deprecatedAuthRoutes);
