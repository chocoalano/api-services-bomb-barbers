import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope } from '../../../middleware/rbac';
import { QueueController } from './controller';
import { queueDocs } from './docs';

export const queueRoutes = new Elysia({ prefix: '/api/v1/admin/branches/:branchId/realtime-queue' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requireBranchScope((ctx: any) => ctx.params?.branchId))
  .get('/', QueueController.stream, queueDocs.stream);
