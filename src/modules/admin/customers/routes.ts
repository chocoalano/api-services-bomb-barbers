import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { CustomerSearchController } from './controller';
import { AdminCustomerListController } from './list.controller';
import { customerSearchDocs } from './docs';

// Pencarian customer membuka PII (nama/telepon/email). Wajib permission
// 'view_customers' — barber (tanpa permission) tidak boleh men-dump seluruh PII. (H5)
export const adminCustomerRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('view_customers'))
  .get('/customers', CustomerSearchController.searchCustomers, customerSearchDocs.searchCustomers)
  // Daftar & statistik pelanggan (server-side, role-scoped). Cakupan cabang
  // di-resolve per peran di controller (super_admin: semua; branch_admin: hanya
  // pelanggan yang punya appointment di cabangnya).
  .get('/customers/list', AdminCustomerListController.list, customerSearchDocs.listCustomers)
  .get('/customers/stats', AdminCustomerListController.stats, customerSearchDocs.customerStats);
