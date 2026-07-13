import { db } from '../lib/db';
import { staffUserRoles, roles, barbers, rolePermissions, permissions } from '../db/schema';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { redis } from '../lib/redis';
import { createErrorResponse } from '../shared/response';

const RBAC_CACHE_TTL = 60; // detik
const rbacCacheKey = (staffUserId: string) => `rbac:staff:${staffUserId}`;

interface RbacProfile {
  roleNames: string[];
  permissionCodes: string[];
  branchIds: string[]; // cabang yang boleh diakses (dari role berbasis cabang + profil barber)
  isGlobal: boolean; // punya role dengan branch_id NULL (akses global/HQ)
}

const unauthorized = () => createErrorResponse('Unauthorized', null, null, null, {
  context: 'rbac.unauthorized',
  status: 401
});

async function loadRbacProfileFromDb(staffUserId: string): Promise<RbacProfile> {
  const rows = await db
    .select({ role_id: staffUserRoles.roleId, branch_id: staffUserRoles.branchId, roleName: roles.name })
    .from(staffUserRoles)
    .innerJoin(roles, eq(staffUserRoles.roleId, roles.id))
    .where(eq(staffUserRoles.staffUserId, staffUserId));

  const roleIds = rows.map((r) => r.role_id);
  const roleNames = Array.from(new Set(rows.map((r) => r.roleName).filter(Boolean)));
  const isGlobal = rows.some((r) => r.branch_id === null);

  const branchIds = new Set<string>();
  rows.forEach((r) => { if (r.branch_id) branchIds.add(r.branch_id); });

  const barberRows = await db
    .select({ branch_id: barbers.branchId })
    .from(barbers)
    .where(and(eq(barbers.staffUserId, staffUserId), isNull(barbers.deletedAt)));
  barberRows.forEach((b) => { if (b.branch_id) branchIds.add(b.branch_id); });

  let permissionCodes: string[] = [];
  if (roleIds.length > 0) {
    const permRows = await db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds));
    permissionCodes = Array.from(new Set(permRows.map((p) => p.code).filter(Boolean)));
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
    return unauthorized();
  }

  const { permissionCodes } = await getRbacProfile(staffId);
  if (!permissionCodes.includes(permissionCode)) {
    set.status = 403;
    return createErrorResponse(`Forbidden: Requires permission '${permissionCode}'`, null, null, null, {
      context: 'rbac.requirePermission',
      status: 403
    });
  }
};

export const requireAnyPermission = (permissionCodes: string[]) => async ({ staffId, set }: any) => {
  if (!staffId) {
    set.status = 401;
    return unauthorized();
  }

  const profile = await getRbacProfile(staffId);
  if (profile.roleNames.includes('super_admin')) return;

  if (!permissionCodes.some((code) => profile.permissionCodes.includes(code))) {
    set.status = 403;
    return createErrorResponse(`Forbidden: Requires one of permissions '${permissionCodes.join("', '")}'`, null, null, null, {
      context: 'rbac.requireAnyPermission',
      status: 403
    });
  }
};

export const requireRole = (roleCode: string) => async ({ staffId, set }: any) => {
  if (!staffId) {
    set.status = 401;
    return unauthorized();
  }

  const { roleNames } = await getRbacProfile(staffId);
  if (!roleNames.includes(roleCode)) {
    set.status = 403;
    return createErrorResponse(`Forbidden: Requires role '${roleCode}'`, null, null, null, {
      context: 'rbac.requireRole',
      status: 403
    });
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
      return unauthorized();
    }

    const targetBranchId = branchIdSource(ctx);
    if (!targetBranchId) {
      set.status = 400;
      return createErrorResponse('Parameter branch_id wajib disertakan', null, null, null, {
        context: 'rbac.requireBranchScope',
        status: 400
      });
    }

    const profile = await getRbacProfile(staffId);
    if (profile.isGlobal) return;

    if (!profile.branchIds.includes(targetBranchId)) {
      set.status = 403;
      return createErrorResponse('Forbidden: Access to this branch is restricted', null, null, null, {
        context: 'rbac.requireBranchScope',
        status: 403
      });
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
      return unauthorized();
    }

    const profile = await getRbacProfile(staffId);
    if (profile.isGlobal) return;

    const targetBranchId = await resolver(ctx);
    if (!targetBranchId) {
      set.status = 404;
      return createErrorResponse('Resource tidak ditemukan', null, null, null, {
        context: 'rbac.requireBranchScopeResolved',
        status: 404
      });
    }

    if (!profile.branchIds.includes(targetBranchId)) {
      set.status = 403;
      return createErrorResponse('Forbidden: Access to this branch is restricted', null, null, null, {
        context: 'rbac.requireBranchScopeResolved',
        status: 403
      });
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
    return unauthorized();
  }

  const [barber] = await db
    .select({ id: barbers.id })
    .from(barbers)
    .where(and(eq(barbers.staffUserId, staffId), isNull(barbers.deletedAt)))
    .limit(1);

  if (!barber) {
    set.status = 403;
    return createErrorResponse('Forbidden: endpoint ini hanya untuk barber', null, null, null, {
      context: 'rbac.requireBarber',
      status: 403
    });
  }
};
