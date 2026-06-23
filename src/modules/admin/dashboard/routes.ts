import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope, requireRole } from '../../../middleware/rbac';
import { DashboardController } from './controller';
import { dashboardDocs } from './docs';

export const adminDashboardRoutes = new Elysia({ prefix: '/api/v1' })
  .use(staffAuthMiddleware)
  .group('/admin/branches/:branchId', (app) => app
    .onBeforeHandle(requireBranchScope((context: any) => context.params.branchId))
    .get('/dashboard/today', DashboardController.getAdminToday, dashboardDocs.adminToday)
    .get('/appointments/summary', DashboardController.getAdminSummary, dashboardDocs.appointmentSummary)
    .get('/payments/summary', DashboardController.getAdminSummary, dashboardDocs.paymentSummary)
    .get('/commissions/summary', DashboardController.getAdminSummary, dashboardDocs.commissionSummary)
  )
  .group('/hq', (app) => app
    .onBeforeHandle(requireRole('super_admin'))
    .get('/dashboard/today', DashboardController.getHQToday, dashboardDocs.hqToday)
    .get('/branches/summary', DashboardController.getHQBranchSummary, dashboardDocs.hqSummary)
  );
