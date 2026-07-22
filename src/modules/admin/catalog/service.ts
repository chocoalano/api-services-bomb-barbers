import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { db } from '../../../lib/db';
import { snakeKeys, camelKeys, toDbDate } from '../../../db/helpers';
import { branches, barbers, staffUsers, customers, services, servicePrices, branchOperatingHours } from '../../../db/schema';
import { and, eq, isNull, inArray, asc, desc } from 'drizzle-orm';
import { revokeAccountSessions } from '../../../core/auth/session-revocation';
import { BOOKING_CONFIG, minutesToTime, timeToMinutes } from '../../../config/booking';

async function selectOneSnake(table: any, id: string) {
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return snakeKeys(row);
}

const badRequest = (message: string, status = 400) => {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
};

// Normalisasi 'H:MM' / 'HH:MM' / 'HH:MM:SS' → 'HH:MM:SS' (kolom MySQL `time`),
// menolak nilai yang tak valid. Dipakai saat set jam operasional cabang.
const normalizeTimeOrThrow = (value: any, field: string): string => {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw badRequest(`${field} harus format HH:MM.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  if (h > 23 || min > 59 || sec > 59) throw badRequest(`${field} tidak valid.`);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(min)}:${pad(sec)}`;
};

/** Baca 'HH:MM:SS' DB → 'HH:MM' untuk output ke klien. */
const toHHMM = (value: any): string => String(value ?? '').slice(0, 5);

export class AdminCatalogService {
  // Branches
  static async createBranch(data: any) {
    const id = data.id ?? randomUUID();
    await db.insert(branches).values({ ...camelKeys(data), id } as any);

    // [E4] Cabang tanpa baris `branch_operating_hours` TIDAK BISA menerima
    // booking sama sekali (prosedur atomik menolak, dan sejak revisi ini
    // generator slot pun berhenti menawarkan slot palsu). Karena itu cabang
    // baru langsung diberi jam kerja default 08:00–22:00 untuk tujuh hari;
    // admin tinggal menyesuaikannya bila cabang buka/tutup di jam lain.
    await db.insert(branchOperatingHours).values(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        id: randomUUID(),
        branchId: id,
        dayOfWeek,
        openTime: `${minutesToTime(BOOKING_CONFIG.operationalStartMinutes)}:00`,
        closeTime: `${minutesToTime(BOOKING_CONFIG.operationalLastBookingMinutes)}:00`
      })) as any
    );

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

  // Branch operating hours (jam buka/tutup per hari) ------------------------

  /** Jam operasional cabang (7 hari, urut day_of_week). */
  static async getOperatingHours(branchId: string) {
    const rows = await db
      .select({
        day_of_week: branchOperatingHours.dayOfWeek,
        open_time: branchOperatingHours.openTime,
        close_time: branchOperatingHours.closeTime,
        is_closed: branchOperatingHours.isClosed
      })
      .from(branchOperatingHours)
      .where(eq(branchOperatingHours.branchId, branchId))
      .orderBy(asc(branchOperatingHours.dayOfWeek));

    return rows.map((r) => {
      const isClosed = Boolean(r.is_closed);
      return {
        day_of_week: r.day_of_week,
        is_closed: isClosed,
        open_time: isClosed ? null : toHHMM(r.open_time),
        close_time: isClosed ? null : toHHMM(r.close_time)
      };
    });
  }

  /**
   * Set penuh (replace) jam operasional cabang untuk 7 hari sekaligus, atomik.
   * Setiap entri: { day_of_week 0..6, is_closed?, open_time?, close_time? }.
   * - is_closed=true → hari libur; open_time/close_time diabaikan.
   * - is_closed=false/absen → open_time & close_time wajib, open < close.
   */
  static async setOperatingHours(branchId: string, days: any) {
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), isNull(branches.deletedAt)))
      .limit(1);
    if (!branch) throw badRequest('Cabang tidak ditemukan', 404);

    if (!Array.isArray(days) || days.length !== 7) {
      throw badRequest('operating_hours wajib berisi tepat 7 hari (day_of_week 0..6).');
    }

    const seen = new Set<number>();
    const normalized = days.map((d: any) => {
      const dow = Number(d?.day_of_week);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        throw badRequest('day_of_week harus bilangan 0..6.');
      }
      if (seen.has(dow)) throw badRequest(`day_of_week ${dow} duplikat.`);
      seen.add(dow);

      if (d?.is_closed === true) {
        return { dayOfWeek: dow, isClosed: true, openTime: '00:00:00', closeTime: '00:00:00' };
      }
      const openTime = normalizeTimeOrThrow(d?.open_time, `open_time (hari ${dow})`);
      const closeTime = normalizeTimeOrThrow(d?.close_time, `close_time (hari ${dow})`);
      if (timeToMinutes(closeTime) <= timeToMinutes(openTime)) {
        throw badRequest(`Jam tutup harus setelah jam buka (hari ${dow}).`);
      }
      return { dayOfWeek: dow, isClosed: false, openTime, closeTime };
    });

    await db.transaction(async (tx) => {
      await tx.delete(branchOperatingHours).where(eq(branchOperatingHours.branchId, branchId));
      await tx.insert(branchOperatingHours).values(
        normalized.map((n) => ({
          id: randomUUID(),
          branchId,
          dayOfWeek: n.dayOfWeek,
          openTime: n.openTime,
          closeTime: n.closeTime,
          isClosed: n.isClosed
        })) as any
      );
    });

    return this.getOperatingHours(branchId);
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

    // [G2] Menolak kepster harus benar-benar memutus aksesnya. Sebelum ini,
    // kolom `approval_status` berubah tetapi sesinya jalan terus — kepster yang
    // baru ditolak masih bisa menerima order, chat, dan memanggil /withdraw.
    if (nextStatus === 'rejected' && barber.staff_user_id) {
      await revokeAccountSessions({
        userType: 'staff',
        userId: barber.staff_user_id,
        reason: 'account_rejected'
      });
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
    const [barber] = await db
      .select({ staffUserId: barbers.staffUserId })
      .from(barbers)
      .where(eq(barbers.id, id))
      .limit(1);

    await db.update(barbers).set({ deletedAt: toDbDate(new Date()) }).where(eq(barbers.id, id));

    // [G2] Soft-delete profil barber tidak menyentuh `staff_users`, sehingga
    // tanpa pencabutan ini token lamanya tetap lolos middleware staff.
    if (barber?.staffUserId) {
      await revokeAccountSessions({
        userType: 'staff',
        userId: barber.staffUserId,
        reason: 'account_deleted'
      });
    }
    return true;
  }

  /** Ambil staff_user_id & cabang milik satu barber (untuk aksi suspend). */
  static async getBarberStaffUser(barberId: string) {
    const [barber] = await db
      .select({ staff_user_id: barbers.staffUserId, branch_id: barbers.branchId })
      .from(barbers)
      .where(and(eq(barbers.id, barberId), isNull(barbers.deletedAt)))
      .limit(1);
    return barber ?? null;
  }

  /**
   * Aktifkan/nonaktifkan akun staff (termasuk kepster). [G2]
   *
   * Sebelum ini tidak ada satu pun jalur tulis untuk `staff_users.is_active` —
   * "suspend" hanya bisa lewat DB manual, dan karena itu tidak pernah mencabut
   * sesi. Menonaktifkan akun kini langsung memutus seluruh sesinya.
   */
  static async setStaffActive(staffUserId: string, isActive: boolean) {
    const [staff] = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, staffUserId), isNull(staffUsers.deletedAt)))
      .limit(1);

    if (!staff) {
      const notFound = new Error('Staff tidak ditemukan') as Error & { status?: number };
      notFound.status = 404;
      throw notFound;
    }

    await db
      .update(staffUsers)
      .set({ isActive })
      .where(eq(staffUsers.id, staffUserId));

    if (!isActive) {
      await revokeAccountSessions({
        userType: 'staff',
        userId: staffUserId,
        reason: 'account_suspended'
      });
    }

    return { id: staffUserId, is_active: isActive };
  }

  /** Aktifkan/nonaktifkan akun customer. [G2] */
  static async setCustomerActive(customerId: string, isActive: boolean) {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
      .limit(1);

    if (!customer) {
      const notFound = new Error('Pelanggan tidak ditemukan') as Error & { status?: number };
      notFound.status = 404;
      throw notFound;
    }

    await db.update(customers).set({ isActive }).where(eq(customers.id, customerId));

    if (!isActive) {
      await revokeAccountSessions({
        userType: 'customer',
        userId: customerId,
        reason: 'account_suspended'
      });
    }

    return { id: customerId, is_active: isActive };
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
