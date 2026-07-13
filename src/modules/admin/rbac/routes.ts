import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireAnyPermission } from '../../../middleware/rbac';
import { AdminController } from './controller';
import { adminDocs } from './docs';

const canManageUsers = requireAnyPermission(['manage_users', 'manage_staff']);
const canManageRoles = requireAnyPermission(['manage_roles', 'manage_staff']);
const canReadAccessCatalog = requireAnyPermission(['manage_users', 'manage_roles', 'manage_staff']);

// Rute HQ/manajemen pusat. `manage_staff` tetap didukung sebagai permission lama,
// sementara UI baru dapat memakai permission yang lebih spesifik:
// `manage_users` untuk assignment staff dan `manage_roles` untuk master role.
// Namespace /hq dipisahkan dari /admin (operasional cabang) agar guard konsisten per-prefix.
export const adminRbacRoutes = new Elysia({ prefix: '/api/v1/hq' })
  .use(staffAuthMiddleware)
  .get('/staff-users', AdminController.listStaffUsers, {
    ...adminDocs.listStaffUsers,
    beforeHandle: canManageUsers
  })
  .get('/roles', AdminController.getRoles, {
    ...adminDocs.getRoles,
    beforeHandle: canReadAccessCatalog
  })
  .post('/roles', AdminController.createRole, {
    ...adminDocs.createRole,
    beforeHandle: canManageRoles
  })
  .get('/permissions', AdminController.getPermissions, {
    ...adminDocs.getPermissions,
    beforeHandle: canReadAccessCatalog
  })
  .get('/staff-users/:id/roles', AdminController.getStaffRoles, {
    ...adminDocs.getStaffRoles,
    beforeHandle: canManageUsers
  })
  .post('/staff-users/:id/roles', AdminController.assignRole, {
    ...adminDocs.assignRole,
    beforeHandle: canManageUsers
  })
  .delete('/staff-users/:id/roles/:roleId', AdminController.revokeRole, {
    ...adminDocs.revokeRole,
    beforeHandle: canManageUsers
  });
