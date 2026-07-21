import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { AdminCatalogService } from './service';
import { getRbacProfile } from '../../../middleware/rbac';
import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { barbers, branches } from '../../../db/schema';
import { and, eq, isNull, inArray, asc } from 'drizzle-orm';
import { AuditService } from '../audit/service';

// Branch scope guard for barber mutations: HQ staff bypass, branch staff restricted to own branch.
async function assertBarberBranchScope(barberId: string, staffId: string): Promise<void> {
  const profile = await getRbacProfile(staffId);
  if (profile.isGlobal) return;

  const [barber] = await db
    .select({ branch_id: barbers.branchId })
    .from(barbers)
    .where(and(eq(barbers.id, barberId), isNull(barbers.deletedAt)))
    .limit(1);

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

// Resolusi & validasi branch_id untuk aksi CREATE oleh staff non-global. HQ (global)
// bebas menempatkan di cabang manapun (termasuk null). Staff cabang: wajib ke salah
// satu cabang wewenangnya; jika hanya punya satu cabang, dipakai sebagai default.
async function resolveBranchForCreate(bodyBranchId: string | undefined, staffId: string): Promise<string | null> {
  const profile = await getRbacProfile(staffId);
  if (profile.isGlobal) return bodyBranchId ?? null;
  if (profile.branchIds.length === 0) {
    const err = new Error('Forbidden: Anda tidak terhubung ke cabang manapun') as any;
    err.status = 403; throw err;
  }
  const branchId = bodyBranchId ?? (profile.branchIds.length === 1 ? profile.branchIds[0] : undefined);
  if (!branchId) {
    const err = new Error('branch_id wajib dipilih') as any;
    err.status = 400; throw err;
  }
  if (!profile.branchIds.includes(branchId)) {
    const err = new Error('Forbidden: cabang di luar wewenang Anda') as any;
    err.status = 403; throw err;
  }
  return branchId;
}

// Validasi bahwa branch_id tujuan (mis. saat memindahkan barber antar cabang) berada
// dalam wewenang staff non-global.
async function assertTargetBranchInScope(branchId: string, staffId: string): Promise<void> {
  const profile = await getRbacProfile(staffId);
  if (profile.isGlobal) return;
  if (!profile.branchIds.includes(branchId)) {
    const err = new Error('Forbidden: cabang tujuan di luar wewenang Anda') as any;
    err.status = 403; throw err;
  }
}

export class AdminCatalogController {
  // Branches
  static async listBranches({ staffId, set }: any) {
    try {
      const profile = await getRbacProfile(staffId);

      const conds = [isNull(branches.deletedAt)];
      if (!profile.isGlobal) {
        if (profile.branchIds.length === 0) return createSuccessResponse('Daftar cabang', []);
        conds.push(inArray(branches.id, profile.branchIds));
      }

      const data = snakeKeys(
        await db
          .select({
            id: branches.id,
            name: branches.name,
            address: branches.address,
            phone: branches.phone,
            latitude: branches.latitude,
            longitude: branches.longitude,
            is_active: branches.isActive,
            region_id: branches.regionId
          })
          .from(branches)
          .where(and(...conds))
          .orderBy(asc(branches.name))
      );
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
  static async listBarbers({ staffId, set }: any) {
    try {
      const profile = await getRbacProfile(staffId);
      const branchIds = profile.isGlobal ? undefined : profile.branchIds;
      if (branchIds && branchIds.length === 0) return createSuccessResponse('Daftar barber', []);
      const data = await AdminCatalogService.listBarbers(branchIds);
      return createSuccessResponse('Daftar barber', data);
    } catch (e: any) { set.status = 500; return createErrorResponse(e.message); }
  }

  // [REVISI C1] Daftar kepster menunggu konfirmasi (di-scope ke cabang staff non-global).
  static async listPendingBarbers({ staffId, set }: any) {
    try {
      const profile = await getRbacProfile(staffId);
      const branchIds = profile.isGlobal ? undefined : profile.branchIds;
      if (branchIds && branchIds.length === 0) return createSuccessResponse('Daftar kepster menunggu konfirmasi', []);
      const data = await AdminCatalogService.listPendingBarbers(branchIds);
      return createSuccessResponse('Daftar kepster menunggu konfirmasi', data);
    } catch (e: any) { set.status = 500; return createErrorResponse(e.message); }
  }

  // [REVISI C1] Setujui / tolak pendaftaran kepster (hanya cabang wewenang staff).
  static async updateBarberApproval({ params, body, staffId, set }: any) {
    try {
      await assertBarberBranchScope(params.id, staffId);
      const action = body?.action;
      const barber = await AdminCatalogService.setBarberApproval(params.id, action);
      await AuditService.logAction(
        'admin', staffId,
        action === 'approve' ? 'APPROVE_BARBER' : 'REJECT_BARBER',
        'barbers', params.id,
        null,
        { approval_status: barber.approval_status, reason: body?.reason ?? null },
        barber.branch_id
      );
      return createSuccessResponse(
        action === 'approve' ? 'Kepster disetujui' : 'Pendaftaran kepster ditolak',
        barber
      );
    } catch (e: any) { set.status = e.status || 400; return createErrorResponse(e.message); }
  }

  static async createBarber({ body, staffId, set }: any) {
    try {
      const branchId = await resolveBranchForCreate(body?.branch_id, staffId);
      const b = await AdminCatalogService.createBarber({ ...body, branch_id: branchId });
      set.status = 201; return createSuccessResponse('Barber dibuat', b);
    } catch(e: any) { set.status = e.status || 400; return createErrorResponse(e.message); }
  }
  static async updateBarber({ params, body, staffId, set }: any) {
    try {
      // Barber yang diedit harus dalam wewenang; bila memindahkan cabang, cabang
      // tujuan juga harus dalam wewenang staff non-global.
      await assertBarberBranchScope(params.id, staffId);
      if (body?.branch_id) await assertTargetBranchInScope(body.branch_id, staffId);
      const b = await AdminCatalogService.updateBarber(params.id, body);
      return createSuccessResponse('Barber diupdate', b);
    } catch(e: any) { set.status = e.status || 400; return createErrorResponse(e.message); }
  }
  // [G2] Aktifkan/nonaktifkan akun kepster. Menonaktifkan LANGSUNG mencabut
  // seluruh sesinya (token lama tidak bisa dipakai lagi, socket ditendang).
  static async setBarberActive({ params, body, staffId, set }: any) {
    try {
      await assertBarberBranchScope(params.id, staffId);
      const isActive = body?.is_active === true;

      const barber = await AdminCatalogService.getBarberStaffUser(params.id);
      if (!barber?.staff_user_id) {
        set.status = 404;
        return createErrorResponse('Kepster tidak ditemukan');
      }

      const result = await AdminCatalogService.setStaffActive(
        barber.staff_user_id,
        isActive
      );
      await AuditService.logAction(
        'admin', staffId,
        isActive ? 'ACTIVATE_BARBER' : 'SUSPEND_BARBER',
        'staff_users', barber.staff_user_id,
        null,
        { is_active: isActive, reason: body?.reason ?? null },
        barber.branch_id
      );
      return createSuccessResponse(
        isActive ? 'Akun kepster diaktifkan' : 'Akun kepster dinonaktifkan',
        result
      );
    } catch (e: any) { set.status = e.status || 400; return createErrorResponse(e.message); }
  }

  // [G2] Aktifkan/nonaktifkan akun pelanggan, dengan pencabutan sesi yang sama.
  static async setCustomerActive({ params, body, staffId, set }: any) {
    try {
      const isActive = body?.is_active === true;
      const result = await AdminCatalogService.setCustomerActive(params.id, isActive);
      await AuditService.logAction(
        'admin', staffId,
        isActive ? 'ACTIVATE_CUSTOMER' : 'SUSPEND_CUSTOMER',
        'customers', params.id,
        null,
        { is_active: isActive, reason: body?.reason ?? null },
        null
      );
      return createSuccessResponse(
        isActive ? 'Akun pelanggan diaktifkan' : 'Akun pelanggan dinonaktifkan',
        result
      );
    } catch (e: any) { set.status = e.status || 400; return createErrorResponse(e.message); }
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
