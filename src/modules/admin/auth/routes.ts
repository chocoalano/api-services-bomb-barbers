import { Elysia } from 'elysia';
import { setupAuth, staffAuthMiddleware } from '../../../middleware/auth';
import { StaffAuthController } from './controller';
import { adminAuthDocs } from './docs';

export const adminAuthRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(setupAuth)
  .group('/auth', (app) => app
    .post('/login', StaffAuthController.login, adminAuthDocs.login)
    .post('/refresh', StaffAuthController.refresh, adminAuthDocs.refresh)
    .post('/logout', StaffAuthController.logout, adminAuthDocs.logout)
  )
  .use(staffAuthMiddleware)
  .get('/me', StaffAuthController.getProfile, adminAuthDocs.getProfile);
