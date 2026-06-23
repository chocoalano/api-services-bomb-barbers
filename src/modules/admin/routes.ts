import { Elysia } from 'elysia';
import { adminRbacRoutes } from './rbac/routes';
import { adminAuthRoutes } from './auth/routes';
import { adminCatalogRoutes, adminBranchListRoute } from './catalog/routes';
import { adminAppointmentRoutes } from './appointments/routes';
import { adminPaymentRoutes } from './payments/routes';
import { auditRoutes } from './audit/routes';
import { adminCommissionRoutes } from './commissions/routes';
import { adminDashboardRoutes } from './dashboard/routes';
import { expenseRoutes } from './expenses/routes';
import { queueRoutes } from './queue/routes';
import { analyticsRoutes } from './analytics/routes';
import { adminMediaRoutes } from './media/routes';
import { adminBarberRoutes } from './barbers/routes';
import { adminPasswordRoutes } from './password/routes';
import { adminNotificationRoutes } from './notifications/routes';
import { adminCustomerRoutes } from './customers/routes';

export const adminRoutes = new Elysia()
  .use(adminAuthRoutes)
  .use(adminRbacRoutes)
  .use(adminBranchListRoute)
  .use(adminCatalogRoutes)
  .use(adminAppointmentRoutes)
  .use(adminPaymentRoutes)
  .use(auditRoutes)
  .use(adminCommissionRoutes)
  .use(adminDashboardRoutes)
  .use(expenseRoutes)
  .use(queueRoutes)
  .use(analyticsRoutes)
  .use(adminMediaRoutes)
  .use(adminBarberRoutes)
  .use(adminPasswordRoutes)
  .use(adminNotificationRoutes)
  .use(adminCustomerRoutes);

