import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { db } from '../../lib/db';
import {
  staffUsers,
  barbers,
  branches,
  regions,
  appointments,
  staffUserRoles,
  roles,
  rolePermissions,
  permissions
} from '../../db/schema';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';

const DEFAULT_BARBER_RADIUS_KM = 5;

// RBAC di-flatten langsung dari join (pengganti embed bertingkat relasi
// staff_user_roles → roles → role_permissions → permissions).
async function loadStaffRbac(staffId: string) {
  const rows = await db
    .select({
      branchId: staffUserRoles.branchId,
      roleName: roles.name,
      permCode: permissions.code
    })
    .from(staffUserRoles)
    .leftJoin(roles, eq(staffUserRoles.roleId, roles.id))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(staffUserRoles.staffUserId, staffId));

  const roleNames = [...new Set(rows.map((r) => r.roleName).filter(Boolean))] as string[];
  const permCodes = [...new Set(rows.map((r) => r.permCode).filter(Boolean))] as string[];
  const branchIds = [...new Set(rows.map((r) => r.branchId).filter(Boolean))] as string[];
  const isGlobal = rows.some((r) => r.branchId === null);
  return { roles: roleNames, permissions: permCodes, branchIds, isGlobal };
}

export class StaffAuthService {
  static async login(data: any) {
    const { email, password } = data;

    const [staff] = await db
      .select({
        id: staffUsers.id,
        full_name: staffUsers.fullName,
        email: staffUsers.email,
        password_hash: staffUsers.passwordHash,
        is_active: staffUsers.isActive,
        deleted_at: staffUsers.deletedAt
      })
      .from(staffUsers)
      .where(and(eq(staffUsers.email, email), isNull(staffUsers.deletedAt)))
      .limit(1);

    if (!staff) throw new Error('Kredensial tidak valid');
    if (!staff.is_active || staff.deleted_at) throw new Error('Akun staff tidak aktif');
    if (!staff.password_hash) throw new Error('Kredensial tidak valid (akun lama tanpa kata sandi)');

    const isValid = await argon2.verify(staff.password_hash, password);
    if (!isValid) throw new Error('Kredensial tidak valid');

    // [REVISI C1] Gating persetujuan kepster.
    const [barber] = await db
      .select({ approval_status: barbers.approvalStatus })
      .from(barbers)
      .where(and(eq(barbers.staffUserId, staff.id), isNull(barbers.deletedAt)))
      .limit(1);

    if (barber?.approval_status === 'pending') {
      const error = new Error('Akun Anda masih menunggu konfirmasi admin') as Error & { status?: number };
      error.status = 403;
      throw error;
    }
    if (barber?.approval_status === 'rejected') {
      const error = new Error('Pendaftaran Anda ditolak admin') as Error & { status?: number };
      error.status = 403;
      throw error;
    }

    const rbac = await loadStaffRbac(staff.id);
    return { id: staff.id, full_name: staff.full_name, email: staff.email, ...rbac };
  }

  static async register(data: {
    full_name: string;
    email: string;
    password: string;
    phone?: string | null;
    branch_id: string;
    display_name?: string | null;
  }) {
    const fullName = data.full_name?.trim();
    const email = data.email?.trim().toLowerCase();
    const password = data.password;

    if (!fullName) throw new Error('full_name wajib diisi');
    if (!email) throw new Error('email wajib diisi');
    if (!password || password.length < 6) throw new Error('password minimal 6 karakter');
    if (!data.branch_id) throw new Error('branch_id wajib diisi');

    const [existing] = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(eq(staffUsers.email, email), isNull(staffUsers.deletedAt)))
      .limit(1);

    if (existing) {
      const error = new Error('Email sudah terdaftar') as Error & { status?: number };
      error.status = 409;
      throw error;
    }

    const passwordHash = await argon2.hash(password);

    const staffId = randomUUID();
    try {
      await db.insert(staffUsers).values({
        id: staffId,
        fullName,
        email,
        phone: data.phone?.trim() || null,
        passwordHash,
        isActive: true
      });
    } catch (e: any) {
      throw new Error('Gagal membuat akun staff: ' + (e?.message || 'unknown'));
    }

    const barberId = randomUUID();
    try {
      await db.insert(barbers).values({
        id: barberId,
        staffUserId: staffId,
        branchId: data.branch_id,
        displayName: data.display_name?.trim() || fullName,
        approvalStatus: 'pending',
        liveStatus: 'offline'
      });
    } catch (e: any) {
      // Best-effort rollback agar tidak meninggalkan staff_users tanpa profil barber.
      await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
      throw new Error('Gagal membuat profil kepster: ' + (e?.message || 'unknown'));
    }

    return { staff_user_id: staffId, barber_id: barberId };
  }

  static async verifyRefresh(payload: any) {
    if (!payload || payload.role !== 'staff') {
      throw new Error('Refresh token tidak valid');
    }

    const [staff] = await db
      .select({
        id: staffUsers.id,
        full_name: staffUsers.fullName,
        email: staffUsers.email,
        is_active: staffUsers.isActive,
        deleted_at: staffUsers.deletedAt
      })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, payload.sub), isNull(staffUsers.deletedAt)))
      .limit(1);

    if (!staff || !staff.is_active || staff.deleted_at) {
      throw new Error('Staff tidak aktif atau tidak ditemukan');
    }

    const rbac = await loadStaffRbac(staff.id);
    return { id: staff.id, full_name: staff.full_name, email: staff.email, ...rbac };
  }

  static async getProfile(staffId: string) {
    const [staffBase] = await db
      .select({
        id: staffUsers.id,
        full_name: staffUsers.fullName,
        email: staffUsers.email,
        phone: staffUsers.phone,
        is_active: staffUsers.isActive,
        created_at: staffUsers.createdAt
      })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, staffId), isNull(staffUsers.deletedAt)))
      .limit(1);

    if (!staffBase) {
      throw new Error('Staff tidak ditemukan');
    }

    const rbac = await loadStaffRbac(staffId);

    const [barber] = await db
      .select({
        id: barbers.id,
        display_name: barbers.displayName,
        branch_id: barbers.branchId,
        rating_avg: barbers.ratingAvg,
        rating_count: barbers.ratingCount,
        live_status: barbers.liveStatus,
        service_radius_km: barbers.serviceRadiusKm
      })
      .from(barbers)
      .where(and(eq(barbers.staffUserId, staffId), isNull(barbers.deletedAt)))
      .limit(1);

    let branch: any = null;
    let region: any = null;
    if (barber?.branch_id) {
      const [branchData] = await db
        .select({
          id: branches.id,
          name: branches.name,
          address: branches.address,
          region_id: branches.regionId,
          regionName: regions.name
        })
        .from(branches)
        .leftJoin(regions, eq(branches.regionId, regions.id))
        .where(eq(branches.id, barber.branch_id))
        .limit(1);
      if (branchData) {
        branch = { id: branchData.id, name: branchData.name, address: branchData.address, region_id: branchData.region_id };
        region = branchData.regionName != null ? { name: branchData.regionName } : null;
      }
    }

    const radiusKm = Number((barber as any)?.service_radius_km ?? DEFAULT_BARBER_RADIUS_KM);
    const ratingAvg = Number((barber as any)?.rating_avg ?? 0);
    const ratingCount = Number((barber as any)?.rating_count ?? 0);

    let isBusy = false;
    if (barber?.id) {
      const activeRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(and(eq(appointments.barberId, barber.id), inArray(appointments.status, ['in_queue', 'in_service'])));
      isBusy = Number(activeRows[0]?.count ?? 0) > 0;
    }

    return {
      ...staffBase,
      roles: rbac.roles,
      permissions: rbac.permissions,
      branch_ids: rbac.branchIds,
      is_global: rbac.isGlobal,
      name: barber?.display_name || staffBase.full_name,
      branch_area: branch?.name || region?.name || branch?.address || '',
      radius_km: Number.isFinite(radiusKm) ? radiusKm : DEFAULT_BARBER_RADIUS_KM,
      rating_avg: Number.isFinite(ratingAvg) ? ratingAvg : 0,
      rating_count: Number.isFinite(ratingCount) ? ratingCount : 0,
      is_busy: isBusy,
      barber: barber
        ? {
            id: barber.id,
            display_name: barber.display_name,
            rating_avg: Number.isFinite(ratingAvg) ? ratingAvg : 0,
            rating_count: Number.isFinite(ratingCount) ? ratingCount : 0,
            live_status: barber.live_status ?? 'offline',
            is_busy: isBusy,
            branch: branch
              ? {
                  id: branch.id,
                  name: branch.name,
                  address: branch.address ?? null,
                  region_name: region?.name ?? null
                }
              : null
          }
        : null
    };
  }
}
