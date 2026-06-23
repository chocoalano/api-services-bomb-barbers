import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope, requireBranchScopeResolved, requirePermission } from '../../../middleware/rbac';
import { appointmentBranchResolver, paymentBranchResolver } from '../../../shared/branch-resolvers';
import { AdminPaymentController, WebhookController } from './controller';
import { paymentDocs } from './docs';

export const adminPaymentRoutes = new Elysia()
  .group('/api/v1/admin', (app) => app
    .use(staffAuthMiddleware)
    .onBeforeHandle(requirePermission('manage_payment'))
    .post('/appointments/:id/payments', AdminPaymentController.createPayment, {
      ...paymentDocs.adminCreatePayment,
      beforeHandle: requireBranchScopeResolved(appointmentBranchResolver)
    })
    .get('/payments/:id', AdminPaymentController.getPaymentDetail, {
      ...paymentDocs.adminGetPaymentDetail,
      beforeHandle: requireBranchScopeResolved(paymentBranchResolver)
    })
    .group('/branches/:branchId', (branchApp) => branchApp
      .onBeforeHandle(requireBranchScope((context: any) => context.params.branchId))
      .get('/payments', AdminPaymentController.getBranchPayments, paymentDocs.adminGetBranchPayments)
    )
  )
  .post('/api/v1/webhooks/payments/:provider', WebhookController.handlePaymentWebhook, paymentDocs.webhookWithProvider)
  .post('/api/v1/payments/webhook', WebhookController.handlePaymentWebhook, paymentDocs.webhookFixed)
  .post('/api/v1/payments/webhook/:provider', WebhookController.handlePaymentWebhook, paymentDocs.webhookWithProvider);
