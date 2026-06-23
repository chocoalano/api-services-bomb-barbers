import { supabase } from '../lib/supabase';
import { redis } from '../lib/redis';

const RBAC_CACHE_TTL = 60; // detik
const rbacCacheKey = (staffUserId: string) => `rbac:staff:${staffUserId}`;

interface RbacProfile {
  roleNames: string[];
  permissionCodes: string[];
  branchIds: string[]; // cabang yang boleh diakses (dari role berbasis cabang + profil barber)
  isGlobal: boolean; // punya role dengan branch_id NULL (akses global/HQ)
}

const unauthorized = { success: false, message: 'Unauthorized', data: null };

async function loadRbacProfileFromDb(staffUserId: string): Promise<RbacProfile> {
  const { data: roleRows } = await supabase
    .from('staff_user_roles')
    .select('role_id, branch_id, roles!inner(name)')
    .eq('staff_user_id', staffUserId);

  const rows = roleRows ?? [];
  const roleIds = rows.map((r: any) => r.role_id);
  const roleNames = Array.from(new Set(rows.map((r: any) => r.roles?.name).filter(Boolean)));
  const isGlobal = rows.some((r: any) => r.branch_id === null);

  const branchIds = new Set<string>();
  rows.forEach((r: any) => { if (r.branch_id) branchIds.add(r.branch_id); });

  const { data: barberRows } = await supabase
    .from('barbers')
    .select('branch_id')
    .eq('staff_user_id', staffUserId)
    .is('deleted_at', null);
  (barberRows ?? []).forEach((b: any) => { if (b.branch_id) branchIds.add(b.branch_id); });

  let permissionCodes: string[] = [];
  if (roleIds.length > 0) {
    const { data: permRows } = await supabase
      .from('role_permissions')
      .select('permissions!inner(code)')
      .in('role_id', roleIds);
    permissionCodes = Array.from(
      new Set((permRows ?? []).map((p: any) => p.permissions?.code).filter(Boolean))
    );
  }

  return { roleNames, permissionCodes, branchIds: Array.from(branchIds), isGlobal };
}

/**
 * Mengambil profil RBAC staff, dengan cache Redis berdurasi pendek (TTL 60 dtk).
 * Jika Redis tidak tersedia, otomatis fallback ke query database.
 */
export async function getRbacProfile(staffUserId: string): Promise<RbacProfile> {
  try {
    const cached = await redis.get(rbacCacheKey(staffUserId));
    if (cached) return JSON.parse(cached) as RbacProfile;
  } catch {
    /* Redis tidak tersedia -> fallback ke DB */
  }

  const profile = await loadRbacProfileFromDb(staffUserId);

  try {
    await redis.set(rbacCacheKey(staffUserId), JSON.stringify(profile), 'EX', RBAC_CACHE_TTL);
  } catch {
    /* abaikan kegagalan penulisan cache */
  }

  return profile;
}

/** Hapus cache RBAC, panggil setelah perubahan role/permission staff. */
export const invalidateRbacCache = async (staffUserId: string): Promise<void> => {
  try {
    await redis.del(rbacCacheKey(staffUserId));
  } catch {
    /* abaikan */
  }
};

export const isGlobalStaff = async (staffUserId: string): Promise<boolean> =>
  (await getRbacProfile(staffUserId)).isGlobal;

export const getStaffAccessibleBranchIds = async (staffUserId: string): Promise<string[]> =>
  (await getRbacProfile(staffUserId)).branchIds;

export const requirePermission = (permissionCode: string) => async ({ staffId, set }: any) => {
  if (!staffId) {
    set.status = 401;
    return unauthorized;
  }

  const { permissionCodes } = await getRbacProfile(staffId);
  if (!permissionCodes.includes(permissionCode)) {
    set.status = 403;
    return { success: false, message: `Forbidden: Requires permission '${permissionCode}'`, data: null };
  }
};

export const requireRole = (roleCode: string) => async ({ staffId, set }: any) => {
  if (!staffId) {
    set.status = 401;
    return unauthorized;
  }

  const { roleNames } = await getRbacProfile(staffId);
  if (!roleNames.includes(roleCode)) {
    set.status = 403;
    return { success: false, message: `Forbidden: Requires role '${roleCode}'`, data: null };
  }
};

/**
 * Membatasi akses ke cabang yang `branchId`-nya dibaca langsung dari request (param/query).
 * Staff global (HQ) selalu lolos.
 */
export const requireBranchScope = (branchIdSource: (ctx: any) => string | undefined | null) =>
  async (ctx: any) => {
    const { staffId, set } = ctx;
    if (!staffId) {
      set.status = 401;
      return unauthorized;
    }

    const targetBranchId = branchIdSource(ctx);
    if (!targetBranchId) {
      set.status = 400;
      return { success: false, message: 'Parameter branch_id wajib disertakan', data: null };
    }

    const profile = await getRbacProfile(staffId);
    if (profile.isGlobal) return;

    if (!profile.branchIds.includes(targetBranchId)) {
      set.status = 403;
      return { success: false, message: 'Forbidden: Access to this branch is restricted', data: null };
    }
  };

/**
 * Membatasi akses cabang ketika `branchId` tidak ada di request dan harus di-resolve
 * secara async dari database (mis. appointment_id -> branch_id).
 * Staff global (HQ) lolos tanpa perlu resolve.
 */
export const requireBranchScopeResolved = (resolver: (ctx: any) => Promise<string | null>) =>
  async (ctx: any) => {
    const { staffId, set } = ctx;
    if (!staffId) {
      set.status = 401;
      return unauthorized;
    }

    const profile = await getRbacProfile(staffId);
    if (profile.isGlobal) return;

    const targetBranchId = await resolver(ctx);
    if (!targetBranchId) {
      set.status = 404;
      return { success: false, message: 'Resource tidak ditemukan', data: null };
    }

    if (!profile.branchIds.includes(targetBranchId)) {
      set.status = 403;
      return { success: false, message: 'Forbidden: Access to this branch is restricted', data: null };
    }
  };

/**
 * Memastikan staff yang mengakses benar-benar memiliki profil barber.
 * Dipakai sebagai guard untuk seluruh endpoint /barber/*.
 */
export const requireBarber = async (ctx: any) => {
  const { staffId, set } = ctx;
  if (!staffId) {
    set.status = 401;
    return unauthorized;
  }

  const { data: barber } = await supabase
    .from('barbers')
    .select('id')
    .eq('staff_user_id', staffId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!barber) {
    set.status = 403;
    return { success: false, message: 'Forbidden: endpoint ini hanya untuk barber', data: null };
  }
};
