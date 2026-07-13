import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { staffUsers, staffUserRoles, roles, branches, permissions } from '../../../db/schema';
import { and, eq, isNull, inArray, asc } from 'drizzle-orm';
import { getRbacProfile } from '../../../middleware/rbac';

// Muat staff_user_roles + relasi roles/branches untuk sejumlah staff, dikelompokkan.
async function rolesByStaff(staffIds: string[]): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {};
  if (staffIds.length === 0) return out;
  const rows = await db
    .select({
      id: staffUserRoles.id,
      staffUserId: staffUserRoles.staffUserId,
      branch_id: staffUserRoles.branchId,
      roleId: roles.id,
      roleName: roles.name,
      branchIdRef: branches.id,
      branchName: branches.name
    })
    .from(staffUserRoles)
    .leftJoin(roles, eq(staffUserRoles.roleId, roles.id))
    .leftJoin(branches, eq(staffUserRoles.branchId, branches.id))
    .where(inArray(staffUserRoles.staffUserId, staffIds));

  for (const r of rows) {
    (out[r.staffUserId] ??= []).push({
      id: r.id,
      branch_id: r.branch_id,
      roles: r.roleId ? { id: r.roleId, name: r.roleName } : null,
      branches: r.branchIdRef ? { id: r.branchIdRef, name: r.branchName } : null
    });
  }
  return out;
}

export class AdminService {
  static async listStaffUsers() {
    const staff = await db
      .select({
        id: staffUsers.id,
        full_name: staffUsers.fullName,
        email: staffUsers.email,
        phone: staffUsers.phone,
        is_active: staffUsers.isActive,
        created_at: staffUsers.createdAt
      })
      .from(staffUsers)
      .where(isNull(staffUsers.deletedAt))
      .orderBy(asc(staffUsers.fullName));

    const grouped = await rolesByStaff(staff.map((s) => s.id));
    return staff.map((s) => ({ ...s, staff_user_roles: grouped[s.id] ?? [] }));
  }

  static async getStaffRoles(staffUserId: string) {
    const grouped = await rolesByStaff([staffUserId]);
    return grouped[staffUserId] ?? [];
  }

  static async getRoles() {
    return snakeKeys(await db.select().from(roles));
  }

  static async createRole(name: string) {
    const id = randomUUID();
    try {
      await db.insert(roles).values({ id, name });
    } catch {
      throw new Error('Gagal membuat role, pastikan nama unik');
    }
    const [role] = snakeKeys(await db.select().from(roles).where(eq(roles.id, id)).limit(1));
    return role;
  }

  static async getPermissions() {
    return snakeKeys(await db.select().from(permissions));
  }

  static async assignRole(
    staffUserId: string,
    roleId: string,
    branchId: string | null | undefined,
    actorStaffId: string
  ) {
    // Validasi target staff & role benar-benar ada (cegah insert referensi sampah).
    const [targetStaffRows, roleRows] = await Promise.all([
      db.select({ id: staffUsers.id }).from(staffUsers).where(and(eq(staffUsers.id, staffUserId), isNull(staffUsers.deletedAt))).limit(1),
      db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.id, roleId)).limit(1)
    ]);
    if (!targetStaffRows[0]) throw new Error('Staff tujuan tidak ditemukan');
    if (!roleRows[0]) throw new Error('Role tidak valid');

    const normalizedBranchId = branchId || null;

    if (normalizedBranchId) {
      const [branch] = await db.select({ id: branches.id }).from(branches).where(eq(branches.id, normalizedBranchId)).limit(1);
      if (!branch) throw new Error('Branch tidak valid');
    }

    // Cegah eskalasi hak (H6).
    const actor = await getRbacProfile(actorStaffId);
    if (!actor.isGlobal) {
      if (!normalizedBranchId) {
        throw new Error('Hanya staff HQ yang dapat memberikan role global');
      }
      if (!actor.branchIds.includes(normalizedBranchId)) {
        throw new Error('Tidak dapat memberikan role untuk cabang di luar wewenang Anda');
      }
    }

    const id = randomUUID();
    try {
      await db.insert(staffUserRoles).values({ id, staffUserId, roleId, branchId: normalizedBranchId });
    } catch {
      throw new Error('Gagal memasangkan role pada staff');
    }
    const [data] = snakeKeys(await db.select().from(staffUserRoles).where(eq(staffUserRoles.id, id)).limit(1));
    return data;
  }

  static async revokeRole(staffUserId: string, roleId: string) {
    await db
      .delete(staffUserRoles)
      .where(and(eq(staffUserRoles.staffUserId, staffUserId), eq(staffUserRoles.roleId, roleId)));
    return true;
  }
}
