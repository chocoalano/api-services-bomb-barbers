import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope, requirePermission } from '../../../middleware/rbac';
import { AdminBarbersController } from './controller';
import { adminBarbersDocs } from './docs';

export const adminBarberRoutes = new Elysia({ prefix: '/api/v1/admin/branches/:branchId' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_appointment'))
  .onBeforeHandle(requireBranchScope((ctx: any) => ctx.params.branchId))
  .get('/barbers', AdminBarbersController.listBarbers, adminBarbersDocs.listBarbers)
  .get('/barbers/:barberId/schedule', AdminBarbersController.getSchedule, adminBarbersDocs.getSchedule)
  .patch('/barbers/:barberId/status', AdminBarbersController.setStatus, adminBarbersDocs.setStatus);
