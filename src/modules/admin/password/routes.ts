import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { PasswordController } from './controller';
import { passwordDocs } from './docs';

export const adminPasswordRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .put('/me/password', PasswordController.updatePassword, passwordDocs.updatePassword);
