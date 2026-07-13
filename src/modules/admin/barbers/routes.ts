import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope, requirePermission } from '../../../middleware/rbac';
import { AdminBarbersController } from './controller';
import { AdminBarberListController } from './list.controller';
import { adminBarbersDocs } from './docs';

export const adminBarberRoutes = new Elysia({ prefix: '/api/v1/admin/branches/:branchId' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_appointment'))
  .onBeforeHandle(requireBranchScope((ctx: any) => ctx.params.branchId))
  .get('/barbers', AdminBarbersController.listBarbers, adminBarbersDocs.listBarbers)
  .get('/barbers/:barberId/schedule', AdminBarbersController.getSchedule, adminBarbersDocs.getSchedule)
  .patch('/barbers/:barberId/status', AdminBarbersController.setStatus, adminBarbersDocs.setStatus);

// Daftar & statistik barber lintas cabang (server-side, role-scoped). Cakupan
// cabang di-resolve per peran di controller (super_admin: semua; branch_admin:
// hanya cabangnya). Barber punya branch_id langsung sehingga difilter langsung.
export const adminBarberListRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_appointment'))
  .get('/barbers', AdminBarberListController.list, adminBarbersDocs.adminList)
  .get('/barbers/stats', AdminBarberListController.stats, adminBarbersDocs.adminStats);
