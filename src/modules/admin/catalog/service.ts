import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { snakeKeys, camelKeys, toDbDate } from '../../../db/helpers';
import { branches, barbers, staffUsers, services, servicePrices } from '../../../db/schema';
import { and, eq, isNull, inArray, asc, desc } from 'drizzle-orm';

async function selectOneSnake(table: any, id: string) {
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return snakeKeys(row);
}

export class AdminCatalogService {
  // Branches
  static async createBranch(data: any) {
    const id = data.id ?? randomUUID();
    await db.insert(branches).values({ ...camelKeys(data), id } as any);
    return selectOneSnake(branches, id);
  }
  static async updateBranch(id: string, data: any) {
    await db.update(branches).set(camelKeys(data)).where(eq(branches.id, id));
    return selectOneSnake(branches, id);
  }
  static async deleteBranch(id: string) {
    await db.update(branches).set({ deletedAt: toDbDate(new Date()) }).where(eq(branches.id, id));
    return true;
  }

  // Barbers. `branchIds` (opsional) membatasi ke cabang tertentu.
  static async listBarbers(branchIds?: string[]) {
    const conds = [isNull(barbers.deletedAt)];
    if (branchIds) conds.push(inArray(barbers.branchId, branchIds));
    const rows = await db
      .select({
        id: barbers.id,
        display_name: barbers.displayName,
        bio: barbers.bio,
        rating_avg: barbers.ratingAvg,
        rating_count: barbers.ratingCount,
        live_status: barbers.liveStatus,
        approval_status: barbers.approvalStatus,
        service_radius_km: barbers.serviceRadiusKm,
        branch_id: barbers.branchId,
        staffFullName: staffUsers.fullName,
        staffEmail: staffUsers.email,
        branchIdRef: branches.id,
        branchName: branches.name
      })
      .from(barbers)
      .leftJoin(staffUsers, eq(barbers.staffUserId, staffUsers.id))
      .leftJoin(branches, eq(barbers.branchId, branches.id))
      .where(and(...conds))
      .orderBy(asc(barbers.displayName));
    return rows.map((b) => ({
      id: b.id,
      display_name: b.display_name,
      bio: b.bio,
      rating_avg: b.rating_avg,
      rating_count: b.rating_count,
      live_status: b.live_status,
      approval_status: b.approval_status,
      service_radius_km: b.service_radius_km,
      branch_id: b.branch_id,
      staff_users: { full_name: b.staffFullName, email: b.staffEmail },
      branches: b.branchIdRef ? { id: b.branchIdRef, name: b.branchName } : null
    }));
  }

  static async listPendingBarbers(branchIds?: string[]) {
    const conds = [eq(barbers.approvalStatus, 'pending'), isNull(barbers.deletedAt)];
    if (branchIds) conds.push(inArray(barbers.branchId, branchIds));
    const rows = await db
      .select({
        id: barbers.id,
        display_name: barbers.displayName,
        branch_id: barbers.branchId,
        live_status: barbers.liveStatus,
        approval_status: barbers.approvalStatus,
        created_at: barbers.createdAt,
        staffFullName: staffUsers.fullName,
        staffEmail: staffUsers.email,
        staffPhone: staffUsers.phone,
        branchIdRef: branches.id,
        branchName: branches.name
      })
      .from(barbers)
      .leftJoin(staffUsers, eq(barbers.staffUserId, staffUsers.id))
      .leftJoin(branches, eq(barbers.branchId, branches.id))
      .where(and(...conds))
      .orderBy(asc(barbers.createdAt));
    return rows.map((b) => ({
      id: b.id,
      display_name: b.display_name,
      branch_id: b.branch_id,
      live_status: b.live_status,
      approval_status: b.approval_status,
      created_at: b.created_at,
      staff_users: { full_name: b.staffFullName, email: b.staffEmail, phone: b.staffPhone },
      branches: b.branchIdRef ? { id: b.branchIdRef, name: b.branchName } : null
    }));
  }

  static async setBarberApproval(id: string, action: 'approve' | 'reject') {
    if (!['approve', 'reject'].includes(action)) {
      const error = new Error("action harus 'approve' atau 'reject'") as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    await db
      .update(barbers)
      .set({ approvalStatus: nextStatus })
      .where(and(eq(barbers.id, id), isNull(barbers.deletedAt)));

    const [barber] = await db
      .select({
        id: barbers.id,
        display_name: barbers.displayName,
        branch_id: barbers.branchId,
        approval_status: barbers.approvalStatus,
        staff_user_id: barbers.staffUserId
      })
      .from(barbers)
      .where(and(eq(barbers.id, id), isNull(barbers.deletedAt)))
      .limit(1);

    if (!barber) {
      const notFound = new Error('Barber tidak ditemukan') as Error & { status?: number };
      notFound.status = 404;
      throw notFound;
    }
    return barber;
  }

  static async createBarber(data: {
    full_name: string;
    email: string;
    password: string;
    phone?: string | null;
    display_name?: string | null;
    branch_id?: string | null;
    service_radius_km?: number | null;
  }) {
    const fullName = data.full_name?.trim();
    const email = data.email?.trim().toLowerCase();
    const password = data.password;

    if (!fullName) throw new Error('Nama lengkap wajib diisi');
    if (!email) throw new Error('Email wajib diisi');
    if (!password || password.length < 6) throw new Error('Password minimal 6 karakter');

    const [existing] = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(eq(staffUsers.email, email), isNull(staffUsers.deletedAt)))
      .limit(1);
    if (existing) {
      const err = new Error('Email sudah terdaftar') as Error & { status?: number };
      err.status = 409;
      throw err;
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
    const barberInsert: Record<string, any> = {
      id: barberId,
      staffUserId: staffId,
      branchId: data.branch_id || null,
      displayName: data.display_name?.trim() || fullName,
      approvalStatus: 'approved',
      liveStatus: 'offline'
    };
    if (data.service_radius_km != null) barberInsert.serviceRadiusKm = data.service_radius_km;

    try {
      await db.insert(barbers).values(barberInsert as any);
    } catch (e: any) {
      await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
      throw new Error('Gagal membuat profil kepster: ' + (e?.message || 'unknown'));
    }

    const [barber] = await db
      .select({
        id: barbers.id,
        display_name: barbers.displayName,
        branch_id: barbers.branchId,
        service_radius_km: barbers.serviceRadiusKm,
        approval_status: barbers.approvalStatus,
        staff_user_id: barbers.staffUserId
      })
      .from(barbers)
      .where(eq(barbers.id, barberId))
      .limit(1);
    return barber;
  }
  static async updateBarber(id: string, data: any) {
    await db.update(barbers).set(camelKeys(data)).where(eq(barbers.id, id));
    return selectOneSnake(barbers, id);
  }
  static async deleteBarber(id: string) {
    await db.update(barbers).set({ deletedAt: toDbDate(new Date()) }).where(eq(barbers.id, id));
    return true;
  }

  // Services
  static async listServices() {
    return snakeKeys(
      await db
        .select({
          id: services.id,
          name: services.name,
          description: services.description,
          image_url: services.imageUrl,
          default_duration_min: services.defaultDurationMin,
          is_active: services.isActive,
          created_at: services.createdAt
        })
        .from(services)
        .where(isNull(services.deletedAt))
        .orderBy(asc(services.name))
    );
  }

  static async createService(data: any) {
    const id = data.id ?? randomUUID();
    await db.insert(services).values({ ...camelKeys(data), id } as any);
    return selectOneSnake(services, id);
  }
  static async updateService(id: string, data: any) {
    await db.update(services).set(camelKeys(data)).where(eq(services.id, id));
    return selectOneSnake(services, id);
  }
  static async deleteService(id: string) {
    await db.update(services).set({ deletedAt: toDbDate(new Date()) }).where(eq(services.id, id));
    return true;
  }

  // Service Prices
  static async listServicePrices() {
    const rows = await db
      .select({
        id: servicePrices.id,
        price_amount: servicePrices.priceAmount,
        effective_from: servicePrices.effectiveFrom,
        effective_to: servicePrices.effectiveTo,
        branch_id: servicePrices.branchId,
        region_id: servicePrices.regionId,
        serviceId: services.id,
        serviceName: services.name,
        branchIdRef: branches.id,
        branchName: branches.name
      })
      .from(servicePrices)
      .leftJoin(services, eq(servicePrices.serviceId, services.id))
      .leftJoin(branches, eq(servicePrices.branchId, branches.id))
      .orderBy(desc(servicePrices.effectiveFrom));
    return rows.map((p) => ({
      id: p.id,
      price_amount: p.price_amount,
      effective_from: p.effective_from,
      effective_to: p.effective_to,
      branch_id: p.branch_id,
      region_id: p.region_id,
      services: p.serviceId ? { id: p.serviceId, name: p.serviceName } : null,
      branches: p.branchIdRef ? { id: p.branchIdRef, name: p.branchName } : null
    }));
  }

  // Normalkan field datetime ISO -> format MySQL sebelum insert/update.
  private static normalizePricePayload(data: any) {
    const vals = camelKeys(data);
    if (vals.effectiveFrom !== undefined) vals.effectiveFrom = toDbDate(vals.effectiveFrom);
    if (vals.effectiveTo !== undefined) vals.effectiveTo = vals.effectiveTo == null ? null : toDbDate(vals.effectiveTo);
    return vals;
  }

  static async createServicePrice(data: any) {
    const id = data.id ?? randomUUID();
    await db.insert(servicePrices).values({ ...this.normalizePricePayload(data), id } as any);
    return selectOneSnake(servicePrices, id);
  }
  static async updateServicePrice(id: string, data: any) {
    await db.update(servicePrices).set(this.normalizePricePayload(data)).where(eq(servicePrices.id, id));
    return selectOneSnake(servicePrices, id);
  }
  static async deleteServicePrice(id: string) {
    await db.delete(servicePrices).where(eq(servicePrices.id, id));
    return true;
  }
}
