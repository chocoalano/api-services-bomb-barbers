import { Elysia } from 'elysia';
import { setupAuth, staffAuthMiddleware } from '../../middleware/auth';
import { StaffAuthController } from './controller';
import { staffAuthDocs } from './docs';

export const staffAuthRoutes = new Elysia({ prefix: '/api/v1/staff' })
  .use(setupAuth)
  .group('/auth', (app) =>
    app
      .post('/login', StaffAuthController.login, staffAuthDocs.login)
      .post('/refresh', StaffAuthController.refresh, staffAuthDocs.refresh)
      .post('/logout', StaffAuthController.logout, staffAuthDocs.logout)
  )
  .use(staffAuthMiddleware)
  .get('/me', StaffAuthController.getProfile, staffAuthDocs.getProfile);
