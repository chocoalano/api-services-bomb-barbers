import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { AdminMediaController } from './controller';
import { adminMediaDocs } from './docs';

export const adminMediaRoutes = new Elysia({ prefix: '/api/v1/hq/media' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_service'))
  .post('/upload', AdminMediaController.upload, adminMediaDocs.upload);
