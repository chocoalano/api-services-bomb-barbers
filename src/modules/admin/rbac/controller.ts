import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { AdminService } from './service';
import { invalidateRbacCache } from '../../../middleware/rbac';

export class AdminController {
  static async listStaffUsers({ set }: any) {
    try {
      const data = await AdminService.listStaffUsers();
      return createSuccessResponse('Daftar staff berhasil diambil', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getRoles({ set }: any) {
    try {
      const roles = await AdminService.getRoles();
      return createSuccessResponse('Daftar role berhasil diambil', roles);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async createRole({ body, set }: any) {
    try {
      const role = await AdminService.createRole(body.name);
      set.status = 201;
      return createSuccessResponse('Role baru berhasil dibuat', role);
    } catch (err: any) {
      set.status = 400;
      return createErrorResponse(err.message);
    }
  }

  static async getPermissions({ set }: any) {
    try {
      const perms = await AdminService.getPermissions();
      return createSuccessResponse('Daftar permission berhasil diambil', perms);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getStaffRoles({ params, set }: any) {
    try {
      const data = await AdminService.getStaffRoles(params.id);
      return createSuccessResponse('Role staff berhasil diambil', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async assignRole({ params, body, set }: any) {
    try {
      const assignment = await AdminService.assignRole(params.id, body.role_id, body.branch_id);
      await invalidateRbacCache(params.id); // hapus cache RBAC staff terkait
      set.status = 201;
      return createSuccessResponse('Role berhasil dipasangkan ke staff', assignment);
    } catch (err: any) {
      set.status = 400;
      return createErrorResponse(err.message);
    }
  }

  static async revokeRole({ params, set }: any) {
    try {
      await AdminService.revokeRole(params.id, params.roleId);
      await invalidateRbacCache(params.id); // hapus cache RBAC staff terkait
      return createSuccessResponse('Role berhasil dicabut dari staff', null);
    } catch (err: any) {
      set.status = 400;
      return createErrorResponse(err.message);
    }
  }
}
