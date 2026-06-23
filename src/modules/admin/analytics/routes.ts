import { Elysia } from 'elysia';
import { AnalyticsController } from './controller';
import { analyticsDocs } from './docs';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireRole } from '../../../middleware/rbac';

export const analyticsRoutes = new Elysia({ prefix: '/api/v1/hq' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requireRole('super_admin'))
  .get('/analytics/branches', AnalyticsController.getBranchesAnalytics, analyticsDocs.getBranchesAnalytics)
  .get('/reports/revenue/export', AnalyticsController.exportRevenue, analyticsDocs.exportRevenue)
  .get('/reports/commission/export', AnalyticsController.exportCommission, analyticsDocs.exportCommission);
