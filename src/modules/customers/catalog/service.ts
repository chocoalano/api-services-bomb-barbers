import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { branches, barbers, staffUsers, services, servicePrices } from '../../../db/schema';
import { and, or, eq, isNull, inArray, lte, like, asc, desc, sql } from 'drizzle-orm';
import {
  BranchServiceAreaLogContext,
  BranchServiceAreaService,
  normalizeLocation,
  toFiniteNumber
} from '../../../core/branches/service-area.service';
import { isIdleLiveStatus } from '../../../config/booking';

type BranchServicesQuery = {
  limit?: number | string;
  page?: number | string;
  q?: string;
  search?: string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
};

const DEFAULT_SERVICE_LIMIT = 10;
const MAX_SERVICE_LIMIT = 100;
const MAX_SERVICE_SCAN_LIMIT = 500;

const normalizeLimit = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_SERVICE_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter limit harus berupa angka minimal 1');
  }

  return Math.min(Math.floor(parsed), MAX_SERVICE_LIMIT);
};

const normalizePage = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') {
    return 1;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Parameter page harus berupa angka minimal 1');
  }

  return Math.floor(parsed);
};

const normalizeSearch = (query: BranchServicesQuery) => {
  const keyword = (query.q ?? query.search ?? '').trim();
  if (!keyword) return '';

  return keyword
    .replace(/[,*()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const resolvePriceForService = (prices: any[], serviceId: string, branchId: string, regionId?: string | null) => {
  const servicePrices = prices.filter((price) => price.service_id === serviceId);

  return (
    servicePrices.find((price) => price.branch_id === branchId) ||
    (regionId ? servicePrices.find((price) => price.region_id === regionId) : null) ||
    servicePrices.find((price) => price.branch_id === null && price.region_id === null)
  );
};

export class CatalogService {
  static async getBranches(
    query: BranchServicesQuery = {},
    context: BranchServiceAreaLogContext = {}
  ) {
    const rawLat = query.latitude ?? query.lat;
    const rawLng = query.longitude ?? query.lng;
    if (rawLat !== undefined || rawLng !== undefined) {
      const customerLocation = normalizeLocation(rawLat, rawLng);
      return BranchServiceAreaService.getServiceableBranches(
        customerLocation,
        { ...context, source: context.source ?? 'catalog_branches' }
      );
    }

    return snakeKeys(
      await db.select().from(branches).where(and(eq(branches.isActive, true), isNull(branches.deletedAt)))
    );
  }

  static async getBranchDetail(branchId: string) {
    const [data] = snakeKeys(
      await db.select().from(branches).where(and(eq(branches.id, branchId), isNull(branches.deletedAt))).limit(1)
    );

    if (!data) throw new Error('Cabang tidak ditemukan');
    return data;
  }

  static async getBranchBarbers(
    branchId: string,
    query: BranchServicesQuery = {},
    context: BranchServiceAreaLogContext = {}
  ) {
    const rawLat = query.latitude ?? query.lat;
    const rawLng = query.longitude ?? query.lng;
    if (rawLat !== undefined || rawLng !== undefined) {
      const customerLocation = normalizeLocation(rawLat, rawLng);
      return BranchServiceAreaService.getEligibleBarbersForBranch(
        branchId,
        customerLocation,
        { ...context, source: context.source ?? 'catalog_branch_barbers' }
      );
    }

    const rows = await db
      .select({ barber: barbers, staffId: staffUsers.id, staffIsActive: staffUsers.isActive, staffDeletedAt: staffUsers.deletedAt })
      .from(barbers)
      .leftJoin(staffUsers, eq(barbers.staffUserId, staffUsers.id))
      .where(
        and(
          eq(barbers.branchId, branchId),
          // [REVISI C1] Hanya kepster yang sudah dikonfirmasi admin yang tampil ke customer.
          eq(barbers.approvalStatus, 'approved'),
          isNull(barbers.deletedAt)
        )
      );

    const data = rows.map((r) => ({
      ...snakeKeys(r.barber),
      staff_users: { id: r.staffId, is_active: r.staffIsActive, deleted_at: r.staffDeletedAt }
    }));

    return data
      .filter((barber: any) => {
        const staff = Array.isArray(barber.staff_users) ? barber.staff_users[0] : barber.staff_users;
        const radius = toFiniteNumber(barber.service_radius_km);
        // Sengaja TANPA filter `live_status` — lihat catatan panjang di
        // BranchServiceAreaService.getEligibleBarbersForBranch. Katalog memuat
        // seluruh barber cabang beserta status kehadirannya; yang menentukan
        // bisa/tidaknya dipesan adalah `available_barber_ids` slot.
        return (
          (!staff || (staff.is_active !== false && staff.deleted_at == null)) &&
          radius !== null &&
          radius > 0
        );
      })
      // Query di atas tanpa ORDER BY — urutkan agar hasilnya deterministik.
      // Barber yang siap menerima order tampil lebih dulu.
      .sort((a: any, b: any) => {
        const idleA = isIdleLiveStatus(a.live_status) ? 0 : 1;
        const idleB = isIdleLiveStatus(b.live_status) ? 0 : 1;
        if (idleA !== idleB) return idleA - idleB;
        return String(a.display_name ?? '').localeCompare(String(b.display_name ?? ''));
      });
  }

  static async getActiveServices() {
    return snakeKeys(
      await db.select().from(services).where(and(eq(services.isActive, true), isNull(services.deletedAt)))
    );
  }

  static async getBranchServices(branchId: string, query: BranchServicesQuery = {}) {
    const limit = normalizeLimit(query.limit);
    const page = normalizePage(query.page);
    const search = normalizeSearch(query);

    const [branch] = await db
      .select({ id: branches.id, region_id: branches.regionId, is_active: branches.isActive })
      .from(branches)
      .where(and(eq(branches.id, branchId), isNull(branches.deletedAt)))
      .limit(1);

    if (!branch || branch.is_active === false) {
      throw new Error('Cabang tidak ditemukan atau tidak aktif');
    }

    const serviceConds = [eq(services.isActive, true), isNull(services.deletedAt)];
    if (search) {
      const pattern = `%${search}%`;
      serviceConds.push(or(like(services.name, pattern), like(services.description, pattern))!);
    }

    const serviceRows = await db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        default_duration_min: services.defaultDurationMin,
        image_url: services.imageUrl
      })
      .from(services)
      .where(and(...serviceConds))
      .orderBy(asc(services.name))
      .limit(MAX_SERVICE_SCAN_LIMIT);

    if (serviceRows.length === 0) {
      return [];
    }

    const serviceIds = serviceRows.map((service) => service.id);
    const now = new Date().toISOString();

    const prices = snakeKeys(
      await db
        .select({
          service_id: servicePrices.serviceId,
          branch_id: servicePrices.branchId,
          region_id: servicePrices.regionId,
          price_amount: servicePrices.priceAmount,
          effective_from: servicePrices.effectiveFrom,
          effective_to: servicePrices.effectiveTo
        })
        .from(servicePrices)
        .where(
          and(
            inArray(servicePrices.serviceId, serviceIds),
            lte(servicePrices.effectiveFrom, now),
            or(isNull(servicePrices.effectiveTo), sql`${servicePrices.effectiveTo} >= ${now}`)
          )
        )
        .orderBy(desc(servicePrices.effectiveFrom))
    );

    return serviceRows
      .map((service: any) => {
        const price = resolvePriceForService(prices ?? [], service.id, branchId, branch.region_id);
        if (!price) return null;

        return {
          id: service.id,
          name: service.name,
          description: service.description,
          default_duration_min: service.default_duration_min,
          price_amount: price.price_amount,
          image_url: service.image_url || null
        };
      })
      .filter(Boolean)
      .slice((page - 1) * limit, page * limit);
  }

  static async resolveServicePrice(serviceId: string, branchId: string, atDate: Date = new Date()) {
    // 1. Pastikan service aktif dan tidak di-soft delete
    const [service] = await db
      .select({ is_active: services.isActive, deleted_at: services.deletedAt })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    if (!service || !service.is_active || service.deleted_at !== null) {
      throw new Error('Layanan tidak ditemukan atau tidak aktif');
    }

    // 2. Dapatkan region_id dari branch
    const [branch] = await db
      .select({ region_id: branches.regionId })
      .from(branches)
      .where(and(eq(branches.id, branchId), isNull(branches.deletedAt)))
      .limit(1);

    if (!branch) {
      throw new Error('Cabang tidak ditemukan');
    }

    const regionId = branch.region_id;
    const dateIso = atDate.toISOString();

    // 3. Ambil semua harga yang sudah efektif (effective_from <= atDate)
    const prices = snakeKeys(
      await db
        .select()
        .from(servicePrices)
        .where(and(eq(servicePrices.serviceId, serviceId), lte(servicePrices.effectiveFrom, dateIso)))
    );

    if (!prices || prices.length === 0) {
      throw new Error('Harga layanan tidak tersedia');
    }

    // 4. Filter yang belum expired (effective_to >= atDate OR null)
    const validPrices = prices.filter((p: any) => {
      if (!p.effective_to) return true;
      return new Date(p.effective_to) >= atDate;
    });

    if (validPrices.length === 0) {
      throw new Error('Harga layanan tidak tersedia pada tanggal ini');
    }

    // 5. Resolusi Prioritas
    // P1: Branch Price
    const branchPrice = validPrices.find((p: any) => p.branch_id === branchId);
    if (branchPrice) return branchPrice;

    // P2: Region Price
    if (regionId) {
      const regionPrice = validPrices.find((p: any) => p.region_id === regionId);
      if (regionPrice) return regionPrice;
    }

    // P3: Default Price
    const defaultPrice = validPrices.find((p: any) => p.branch_id === null && p.region_id === null);
    if (defaultPrice) return defaultPrice;

    throw new Error('Tidak ada harga valid yang ditemukan untuk layanan ini');
  }
}
