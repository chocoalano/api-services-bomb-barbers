import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { AdminController } from './controller';
import { adminDocs } from './docs';

// Rute HQ/manajemen pusat — khusus super admin (membutuhkan permission 'manage_staff').
// Namespace /hq dipisahkan dari /admin (operasional cabang) agar guard konsisten per-prefix.
export const adminRbacRoutes = new Elysia({ prefix: '/api/v1/hq' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_staff'))
  .get('/staff-users', AdminController.listStaffUsers, adminDocs.listStaffUsers)
  .get('/roles', AdminController.getRoles, adminDocs.getRoles)
  .post('/roles', AdminController.createRole, adminDocs.createRole)
  .get('/permissions', AdminController.getPermissions, adminDocs.getPermissions)
  .get('/staff-users/:id/roles', AdminController.getStaffRoles, adminDocs.getStaffRoles)
  .post('/staff-users/:id/roles', AdminController.assignRole, adminDocs.assignRole)
  .delete('/staff-users/:id/roles/:roleId', AdminController.revokeRole, adminDocs.revokeRole);
