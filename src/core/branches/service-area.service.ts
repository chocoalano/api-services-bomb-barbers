import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { branches as branchesTable, barbers as barbersTable, staffUsers } from '../../db/schema';
import { and, eq, isNull, inArray, type SQL } from 'drizzle-orm';
import { logger } from '../../lib/logger';
import { isIdleLiveStatus } from '../../config/booking';

const BRANCH_SELECT = {
  id: branchesTable.id,
  name: branchesTable.name,
  address: branchesTable.address,
  latitude: branchesTable.latitude,
  longitude: branchesTable.longitude,
  is_active: branchesTable.isActive,
  deleted_at: branchesTable.deletedAt
};

// Muat barber + relasi staff_users (pengganti embed relasi).
async function loadBarbersWithStaff(cond: SQL) {
  const rows = await db
    .select({
      id: barbersTable.id,
      branch_id: barbersTable.branchId,
      display_name: barbersTable.displayName,
      service_radius_km: barbersTable.serviceRadiusKm,
      approval_status: barbersTable.approvalStatus,
      live_status: barbersTable.liveStatus,
      deleted_at: barbersTable.deletedAt,
      // Profil ringkas. Dulu jalur ber-koordinat (satu-satunya yang dipakai app
      // customer) tidak memilih kolom ini, sehingga kartu barber kehilangan
      // rating & bio yang dikirim jalur tanpa koordinat — dua bentuk response
      // untuk satu endpoint yang sama.
      bio: barbersTable.bio,
      rating_avg: barbersTable.ratingAvg,
      rating_count: barbersTable.ratingCount,
      staffId: staffUsers.id,
      staffIsActive: staffUsers.isActive,
      staffDeletedAt: staffUsers.deletedAt
    })
    .from(barbersTable)
    .leftJoin(staffUsers, eq(barbersTable.staffUserId, staffUsers.id))
    .where(and(cond, isNull(barbersTable.deletedAt)));

  return rows.map((r) => ({
    id: r.id,
    branch_id: r.branch_id,
    display_name: r.display_name,
    service_radius_km: r.service_radius_km,
    approval_status: r.approval_status,
    live_status: r.live_status,
    deleted_at: r.deleted_at,
    bio: r.bio,
    rating_avg: r.rating_avg,
    rating_count: r.rating_count,
    staff_users: { id: r.staffId, is_active: r.staffIsActive, deleted_at: r.staffDeletedAt }
  }));
}

export const CUSTOMER_OUTSIDE_BRANCH_SERVICE_RADIUS =
  'CUSTOMER_OUTSIDE_BRANCH_SERVICE_RADIUS';
export const BRANCH_NOT_SERVICEABLE_FOR_LOCATION =
  'BRANCH_NOT_SERVICEABLE_FOR_LOCATION';
export const BRANCH_SERVICE_AREA_INVALID = 'BRANCH_SERVICE_AREA_INVALID';

type LocationPoint = {
  lat: number;
  lng: number;
};

type BranchRecord = {
  id: string;
  name?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
};

type BarberRecord = {
  id: string;
  branch_id: string;
  display_name?: string | null;
  service_radius_km?: number | string | null;
  approval_status?: string | null;
  live_status?: string | null;
  deleted_at?: string | null;
  bio?: string | null;
  rating_avg?: number | string | null;
  rating_count?: number | null;
  staff_users?: any;
};

export type BranchServiceAreaLogContext = {
  customerId?: string | null;
  requestId?: string | null;
  source?: string;
};

export type BranchServiceAreaResult = {
  branch: BranchRecord;
  barber?: BarberRecord | null;
  customerLatitude: number;
  customerLongitude: number;
  branchLatitude: number | null;
  branchLongitude: number | null;
  distanceMeter: number | null;
  distanceKm: number | null;
  serviceRadiusMeter: number | null;
  serviceRadiusKm: number | null;
  toleranceMeter: number;
  isWithinRadius: boolean;
  reason?: string;
  eligibleBarbers: BarberRecord[];
};

const EARTH_RADIUS_METER = 6_371_000;

const parseNonNegativeNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const getServiceRadiusToleranceMeter = () =>
  parseNonNegativeNumber(process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER, 0.5);

const relationOne = (value: any) => Array.isArray(value) ? value[0] : value;

export const toFiniteNumber = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeLatitude = (value: unknown, label = 'latitude') => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed < -90 || parsed > 90 || parsed === 0) {
    const err: any = new Error(`${label} tidak valid`);
    err.status = 400;
    err.code = 'INVALID_LATITUDE';
    throw err;
  }
  return parsed;
};

export const normalizeLongitude = (value: unknown, label = 'longitude') => {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed < -180 || parsed > 180 || parsed === 0) {
    const err: any = new Error(`${label} tidak valid`);
    err.status = 400;
    err.code = 'INVALID_LONGITUDE';
    throw err;
  }
  return parsed;
};

export const normalizeLocation = (
  latitude: unknown,
  longitude: unknown,
  latitudeLabel = 'latitude',
  longitudeLabel = 'longitude'
): LocationPoint => ({
  lat: normalizeLatitude(latitude, latitudeLabel),
  lng: normalizeLongitude(longitude, longitudeLabel)
});

export const haversineDistanceMeter = (from: LocationPoint, to: LocationPoint) => {
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METER * 2 * Math.asin(Math.sqrt(a));
};

const isActiveStaff = (barber: BarberRecord) => {
  const staff = relationOne(barber.staff_users);
  if (!staff) return true;
  return staff.is_active !== false && staff.deleted_at == null;
};

const isUsableBarber = (barber: BarberRecord) => {
  const radiusKm = toFiniteNumber(barber.service_radius_km);
  return (
    barber.deleted_at == null &&
    (barber.approval_status ?? 'approved') === 'approved' &&
    isActiveStaff(barber) &&
    radiusKm !== null &&
    radiusKm > 0
  );
};

const resultLogPayload = (
  result: BranchServiceAreaResult,
  context: BranchServiceAreaLogContext = {}
) => ({
  customer_id: context.customerId ?? null,
  branch_id: result.branch.id,
  barber_id: result.barber?.id ?? null,
  customer_latitude: result.customerLatitude,
  customer_longitude: result.customerLongitude,
  branch_latitude: result.branchLatitude,
  branch_longitude: result.branchLongitude,
  distance_meter: result.distanceMeter,
  distance_km: result.distanceKm,
  service_radius_meter: result.serviceRadiusMeter,
  service_radius_km: result.serviceRadiusKm,
  tolerance_meter: result.toleranceMeter,
  is_within_radius: result.isWithinRadius,
  request_id: context.requestId ?? null,
  source: context.source ?? null,
  reason: result.reason ?? null
});

const serviceAreaError = (
  code: string,
  message: string,
  result: BranchServiceAreaResult,
  status = 400
) => {
  const err: any = new Error(message);
  err.status = status;
  err.code = code;
  err.data = {
    branch_id: result.branch.id,
    barber_id: result.barber?.id ?? null,
    distance_km: result.distanceKm,
    distance_meter: result.distanceMeter,
    service_radius_km: result.serviceRadiusKm,
    service_radius_meter: result.serviceRadiusMeter,
    tolerance_meter: result.toleranceMeter
  };
  return err;
};

export class BranchServiceAreaService {
  static distanceMeter(from: LocationPoint, to: LocationPoint) {
    return haversineDistanceMeter(from, to);
  }

  static evaluateBranch(
    branch: BranchRecord,
    barbers: BarberRecord[],
    customerLocation: LocationPoint,
    barberId?: string | null
  ): BranchServiceAreaResult {
    const branchLatitude = toFiniteNumber(branch.latitude);
    const branchLongitude = toFiniteNumber(branch.longitude);
    const toleranceMeter = getServiceRadiusToleranceMeter();
    const base = {
      branch,
      customerLatitude: customerLocation.lat,
      customerLongitude: customerLocation.lng,
      branchLatitude,
      branchLongitude,
      distanceMeter: null,
      distanceKm: null,
      serviceRadiusMeter: null,
      serviceRadiusKm: null,
      toleranceMeter,
      isWithinRadius: false,
      eligibleBarbers: [] as BarberRecord[]
    };

    if (branch.is_active === false || branch.deleted_at != null) {
      return { ...base, reason: 'BRANCH_INACTIVE' };
    }
    if (branchLatitude === null || branchLongitude === null) {
      return { ...base, reason: 'BRANCH_COORDINATE_INVALID' };
    }

    const distanceMeter = haversineDistanceMeter(customerLocation, {
      lat: branchLatitude,
      lng: branchLongitude
    });
    const usableBarbers = barbers.filter((barber) =>
      barber.branch_id === branch.id && isUsableBarber(barber)
    );
    const candidates = barberId
      ? usableBarbers.filter((barber) => barber.id === barberId)
      : usableBarbers;
    const eligibleBarbers = candidates.filter((barber) => {
      const radiusKm = toFiniteNumber(barber.service_radius_km);
      if (radiusKm === null || radiusKm <= 0) return false;
      return distanceMeter <= radiusKm * 1000 + toleranceMeter;
    });
    const selectedBarber = barberId
      ? candidates.find((barber) => barber.id === barberId) ?? null
      : eligibleBarbers
          .slice()
          .sort((a, b) =>
            Number(b.service_radius_km || 0) - Number(a.service_radius_km || 0)
          )[0] ?? null;
    const selectedRadiusKm =
      selectedBarber ? toFiniteNumber(selectedBarber.service_radius_km) : null;
    const maxCandidateRadiusKm = candidates.reduce((max, barber) => {
      const radiusKm = toFiniteNumber(barber.service_radius_km);
      return radiusKm !== null && radiusKm > max ? radiusKm : max;
    }, 0);
    const serviceRadiusKm = selectedRadiusKm ?? (maxCandidateRadiusKm > 0 ? maxCandidateRadiusKm : null);
    const result = {
      ...base,
      barber: selectedBarber,
      distanceMeter,
      distanceKm: distanceMeter / 1000,
      serviceRadiusMeter: serviceRadiusKm === null ? null : serviceRadiusKm * 1000,
      serviceRadiusKm,
      isWithinRadius: eligibleBarbers.length > 0,
      eligibleBarbers
    };

    if (usableBarbers.length === 0) return { ...result, reason: 'NO_ACTIVE_BARBER_WITH_RADIUS' };
    if (barberId && candidates.length === 0) return { ...result, reason: 'BARBER_NOT_SERVICEABLE' };
    if (!result.isWithinRadius) return { ...result, reason: 'OUTSIDE_SERVICE_RADIUS' };
    return result;
  }

  static toBranchResponse(result: BranchServiceAreaResult) {
    const branch = result.branch;
    return {
      ...branch,
      latitude: result.branchLatitude,
      longitude: result.branchLongitude,
      lat: result.branchLatitude,
      lng: result.branchLongitude,
      distance_meter: result.distanceMeter,
      distance_km: result.distanceKm,
      service_radius_meter: result.serviceRadiusMeter,
      service_radius_km: result.serviceRadiusKm,
      tolerance_meter: result.toleranceMeter,
      is_within_service_radius: result.isWithinRadius,
      eligible_barber_count: result.eligibleBarbers.length
    };
  }

  static toBarberResponse(barber: BarberRecord, result: BranchServiceAreaResult) {
    return {
      ...barber,
      distance_meter: result.distanceMeter,
      distance_km: result.distanceKm,
      service_radius_meter: result.serviceRadiusMeter,
      service_radius_km: result.serviceRadiusKm,
      tolerance_meter: result.toleranceMeter,
      is_within_service_radius: result.isWithinRadius
    };
  }

  static logBranchComputed(
    result: BranchServiceAreaResult,
    context: BranchServiceAreaLogContext = {}
  ) {
    logger.info(
      resultLogPayload(result, context),
      'Branch service radius computed'
    );
  }

  static logBranchSelected(
    result: BranchServiceAreaResult,
    context: BranchServiceAreaLogContext = {}
  ) {
    logger.info(resultLogPayload(result, context), 'Branch selected for booking');
  }

  static logBookingSubmitted(
    result: BranchServiceAreaResult,
    context: BranchServiceAreaLogContext = {}
  ) {
    logger.info(resultLogPayload(result, context), 'Booking service radius checked');
  }

  static logRadiusRejected(
    result: BranchServiceAreaResult,
    context: BranchServiceAreaLogContext = {}
  ) {
    logger.warn(
      resultLogPayload(result, context),
      'Booking rejected: customer outside branch service radius'
    );
  }

  static async loadBranchAndBarbers(branchId: string) {
    const [branch] = snakeKeys(
      await db.select(BRANCH_SELECT).from(branchesTable).where(eq(branchesTable.id, branchId)).limit(1)
    );

    if (!branch) {
      const err: any = new Error('Cabang tidak ditemukan');
      err.status = 404;
      err.code = 'BRANCH_NOT_FOUND';
      throw err;
    }

    const barbers = await loadBarbersWithStaff(eq(barbersTable.branchId, branchId));

    return { branch: branch as BranchRecord, barbers: barbers as BarberRecord[] };
  }

  static async getServiceableBranches(
    customerLocation: LocationPoint,
    context: BranchServiceAreaLogContext = {}
  ) {
    const branchRows = snakeKeys(
      await db
        .select(BRANCH_SELECT)
        .from(branchesTable)
        .where(and(eq(branchesTable.isActive, true), isNull(branchesTable.deletedAt)))
    ) as BranchRecord[];

    if (branchRows.length === 0) return [];

    const barberRows = (await loadBarbersWithStaff(
      inArray(barbersTable.branchId, branchRows.map((branch) => branch.id))
    )) as BarberRecord[];
    const results = branchRows.map((branch) =>
      this.evaluateBranch(branch, barberRows, customerLocation)
    );
    results.forEach((result) => this.logBranchComputed(result, context));

    const serviceable = results
      .filter((result) => result.isWithinRadius)
      .sort((a, b) => (a.distanceMeter ?? Infinity) - (b.distanceMeter ?? Infinity))
      .map((result) => this.toBranchResponse(result));

    if (serviceable.length > 0) return serviceable;

    // Tidak ada cabang di dalam radius. Kembalikan SATU cabang terdekat yang
    // berada di luar jangkauan (is_within_service_radius=false) agar frontend
    // bisa menampilkan pesan yang informatif: nama cabang terdekat, jarak
    // customer ke cabang tsb, dan radius maksimal layanan cabang tsb.
    // Utamakan cabang yang punya barber aktif (serviceRadiusKm diketahui);
    // jika tidak ada sama sekali, pakai cabang terdekat berdasarkan jarak.
    const withDistance = results.filter((result) => result.distanceMeter != null);
    const withKnownRadius = withDistance.filter(
      (result) => result.serviceRadiusKm != null && result.serviceRadiusKm > 0
    );
    const pool = withKnownRadius.length > 0 ? withKnownRadius : withDistance;
    const nearest = pool
      .slice()
      .sort((a, b) => (a.distanceMeter ?? Infinity) - (b.distanceMeter ?? Infinity))[0];

    return nearest ? [this.toBranchResponse(nearest)] : [];
  }

  static async getEligibleBarbersForBranch(
    branchId: string,
    customerLocation: LocationPoint,
    context: BranchServiceAreaLogContext = {}
  ) {
    const { branch, barbers } = await this.loadBranchAndBarbers(branchId);
    const results = barbers
      .filter((barber) => barber.branch_id === branchId)
      .map((barber) => this.evaluateBranch(branch, barbers, customerLocation, barber.id));
    results.forEach((result) => this.logBranchSelected(result, context));
    return results
      .filter((result) => result.isWithinRadius && result.barber)
      // JANGAN memfilter berdasarkan `live_status` di sini. Endpoint ini adalah
      // KATALOG (siapa saja barber cabang ini), bukan penentu ketersediaan slot.
      // Sebelumnya barber non-idle dibuang, sehingga di produksi — di mana
      // `barbers.live_status` default 'offline' sampai barber menyalakan
      // switch-nya, dan berubah 'serving' selama melayani — daftar barber datang
      // KOSONG dan app customer menampilkan "Barber tidak tersedia". Filter itu
      // juga membuat badge realtime Online/Offline mustahil: barber offline tak
      // pernah ada di daftar untuk diberi badge.
      //
      // Ketersediaan tetap ditegakkan di tempatnya: `evaluateBarber`
      // (core/booking/rules/barber-eligibility.ts) menolak barber non-idle, jadi
      // ia tidak masuk `available_barber_ids` slot dan tidak bisa di-booking.
      // Jarak yang dihitung adalah customer→CABANG, jadi nilainya IDENTIK untuk
      // semua barber di cabang ini dan tidak bisa dipakai mengurutkan. Urutkan
      // barber siap-terima-order lebih dulu, lalu by nama agar deterministik.
      .sort((a, b) => {
        const idleA = isIdleLiveStatus(a.barber!.live_status) ? 0 : 1;
        const idleB = isIdleLiveStatus(b.barber!.live_status) ? 0 : 1;
        if (idleA !== idleB) return idleA - idleB;
        return String(a.barber!.display_name ?? '').localeCompare(
          String(b.barber!.display_name ?? '')
        );
      })
      .map((result) => this.toBarberResponse(result.barber!, result));
  }

  static async assertBranchCanServeLocation(
    branchId: string,
    customerLocation: LocationPoint,
    options: BranchServiceAreaLogContext & { barberId?: string | null } = {}
  ) {
    const { branch, barbers } = await this.loadBranchAndBarbers(branchId);
    const result = this.evaluateBranch(
      branch,
      barbers,
      customerLocation,
      options.barberId ?? null
    );

    this.logBookingSubmitted(result, options);

    if (branch.is_active === false || branch.deleted_at != null) {
      this.logRadiusRejected(result, options);
      throw serviceAreaError(
        BRANCH_SERVICE_AREA_INVALID,
        'Cabang tidak aktif.',
        result,
        404
      );
    }
    if (result.branchLatitude === null || result.branchLongitude === null) {
      this.logRadiusRejected(result, options);
      throw serviceAreaError(
        BRANCH_SERVICE_AREA_INVALID,
        'Koordinat cabang belum dikonfigurasi.',
        result
      );
    }
    if (!result.isWithinRadius) {
      this.logRadiusRejected(result, options);
      throw serviceAreaError(
        CUSTOMER_OUTSIDE_BRANCH_SERVICE_RADIUS,
        'Lokasi Anda berada di luar jangkauan cabang yang dipilih.',
        result
      );
    }

    return result;
  }
}
