import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { CustomerSearchController } from './controller';
import { customerSearchDocs } from './docs';

export const adminCustomerRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .get('/customers', CustomerSearchController.searchCustomers, customerSearchDocs.searchCustomers);
