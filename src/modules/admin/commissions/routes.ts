import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope, requireBranchScopeResolved, requirePermission } from '../../../middleware/rbac';
import { appointmentBranchResolver } from '../../../shared/branch-resolvers';
import { CommissionController } from './controller';
import { commissionDocs } from './docs';

export const adminCommissionRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_commission'))
  .post('/appointments/:id/calculate-commission', CommissionController.calculateCommission, {
    ...commissionDocs.calculateCommission,
    beforeHandle: requireBranchScopeResolved(appointmentBranchResolver)
  })
  .get('/appointments/:id/commission', CommissionController.getCommissionDetail, {
    ...commissionDocs.getCommissionDetail,
    beforeHandle: requireBranchScopeResolved(appointmentBranchResolver)
  })
  .group('/branches/:branchId', (app) => app
    .onBeforeHandle(requireBranchScope((context: any) => context.params.branchId))
    .get('/commissions', CommissionController.getBranchCommissions, commissionDocs.getBranchCommissions)
  );
