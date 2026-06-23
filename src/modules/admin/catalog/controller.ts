import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { AdminCatalogService } from './service';
import { getRbacProfile } from '../../../middleware/rbac';
import { supabase } from '../../../lib/supabase';

// Branch scope guard for barber mutations: HQ staff bypass, branch staff restricted to own branch.
async function assertBarberBranchScope(barberId: string, staffId: string): Promise<void> {
  const profile = await getRbacProfile(staffId);
  if (profile.isGlobal) return;

  const { data: barber } = await supabase
    .from('barbers')
    .select('branch_id')
    .eq('id', barberId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!barber) {
    const err = new Error('Barber tidak ditemukan') as any;
    err.status = 404;
    throw err;
  }
  if (!profile.branchIds.includes(barber.branch_id)) {
    const err = new Error('Forbidden: barber ini bukan bagian dari cabang Anda') as any;
    err.status = 403;
    throw err;
  }
}

export class AdminCatalogController {
  // Branches
  static async listBranches({ staffId, set }: any) {
    try {
      const profile = await getRbacProfile(staffId);
      let query = supabase
        .from('branches')
        .select('id, name, address, phone, latitude, longitude, is_active, region_id')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (!profile.isGlobal) {
        if (profile.branchIds.length === 0) return createSuccessResponse('Daftar cabang', []);
        query = query.in('id', profile.branchIds);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return createSuccessResponse('Daftar cabang', data);
    } catch (e: any) {
      set.status = 500;
      return createErrorResponse(e.message);
    }
  }

  static async createBranch({ body, set }: any) {
    try {
      const branch = await AdminCatalogService.createBranch(body);
      set.status = 201; return createSuccessResponse('Branch dibuat', branch);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
  static async updateBranch({ params, body, set }: any) {
    try {
      const branch = await AdminCatalogService.updateBranch(params.id, body);
      return createSuccessResponse('Branch diupdate', branch);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
  static async deleteBranch({ params, set }: any) {
    try {
      await AdminCatalogService.deleteBranch(params.id);
      return createSuccessResponse('Branch dihapus', null);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }

  // Barbers
  static async listBarbers({ set }: any) {
    try {
      const data = await AdminCatalogService.listBarbers();
      return createSuccessResponse('Daftar barber', data);
    } catch (e: any) { set.status = 500; return createErrorResponse(e.message); }
  }

  static async createBarber({ body, set }: any) {
    try {
      const b = await AdminCatalogService.createBarber(body);
      set.status = 201; return createSuccessResponse('Barber dibuat', b);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
  static async updateBarber({ params, body, staffId, set }: any) {
    try {
      await assertBarberBranchScope(params.id, staffId);
      const b = await AdminCatalogService.updateBarber(params.id, body);
      return createSuccessResponse('Barber diupdate', b);
    } catch(e: any) { set.status = e.status || 400; return createErrorResponse(e.message); }
  }
  static async deleteBarber({ params, staffId, set }: any) {
    try {
      await assertBarberBranchScope(params.id, staffId);
      await AdminCatalogService.deleteBarber(params.id);
      return createSuccessResponse('Barber dihapus', null);
    } catch(e: any) { set.status = e.status || 400; return createErrorResponse(e.message); }
  }

  // Services
  static async listServices({ set }: any) {
    try {
      const data = await AdminCatalogService.listServices();
      return createSuccessResponse('Daftar layanan', data);
    } catch (e: any) { set.status = 500; return createErrorResponse(e.message); }
  }

  static async createService({ body, set }: any) {
    try {
      const s = await AdminCatalogService.createService(body);
      set.status = 201; return createSuccessResponse('Service dibuat', s);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
  static async updateService({ params, body, set }: any) {
    try {
      const s = await AdminCatalogService.updateService(params.id, body);
      return createSuccessResponse('Service diupdate', s);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
  static async deleteService({ params, set }: any) {
    try {
      await AdminCatalogService.deleteService(params.id);
      return createSuccessResponse('Service dihapus', null);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }

  // Service Prices
  static async listServicePrices({ set }: any) {
    try {
      const data = await AdminCatalogService.listServicePrices();
      return createSuccessResponse('Daftar harga layanan', data);
    } catch (e: any) { set.status = 500; return createErrorResponse(e.message); }
  }

  static async createServicePrice({ body, set }: any) {
    try {
      const p = await AdminCatalogService.createServicePrice(body);
      set.status = 201; return createSuccessResponse('Price dibuat', p);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
  static async updateServicePrice({ params, body, set }: any) {
    try {
      const p = await AdminCatalogService.updateServicePrice(params.id, body);
      return createSuccessResponse('Price diupdate', p);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
  static async deleteServicePrice({ params, set }: any) {
    try {
      await AdminCatalogService.deleteServicePrice(params.id);
      return createSuccessResponse('Price dihapus', null);
    } catch(e: any) { set.status = 400; return createErrorResponse(e.message); }
  }
}
