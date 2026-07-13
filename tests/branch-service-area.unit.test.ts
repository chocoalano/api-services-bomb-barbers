import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  BranchServiceAreaService,
  normalizeLocation
} from '../src/core/branches/service-area.service';

const EARTH_RADIUS_METER = 6_371_000;
const BASE = { lat: -6.260721, lng: 106.813911 };

const pointNorth = (point: typeof BASE, meters: number) => ({
  lat: point.lat + (meters / EARTH_RADIUS_METER) * (180 / Math.PI),
  lng: point.lng
});

const branch = (overrides: Record<string, unknown> = {}) => ({
  id: 'branch-test',
  name: 'Branch Test',
  latitude: BASE.lat,
  longitude: BASE.lng,
  is_active: true,
  deleted_at: null,
  ...overrides
});

const barber = (overrides: Record<string, unknown> = {}) => ({
  id: 'barber-test',
  branch_id: 'branch-test',
  display_name: 'Barber Test',
  service_radius_km: 1,
  approval_status: 'approved',
  live_status: 'available',
  deleted_at: null,
  staff_users: {
    is_active: true,
    deleted_at: null
  },
  ...overrides
});

describe('BranchServiceAreaService radius evaluation', () => {
  const previousTolerance = process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER;

  beforeAll(() => {
    process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER = '0.5';
  });

  afterAll(() => {
    if (previousTolerance === undefined) {
      delete process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER;
    } else {
      process.env.BRANCH_SERVICE_RADIUS_TOLERANCE_METER = previousTolerance;
    }
  });

  it('marks a branch serviceable when customer distance is smaller than radius', () => {
    const result = BranchServiceAreaService.evaluateBranch(
      branch(),
      [barber()],
      pointNorth(BASE, 900)
    );

    expect(result.isWithinRadius).toBe(true);
    expect(result.distanceMeter).toBeLessThan(result.serviceRadiusMeter!);
  });

  it('uses inclusive boundary when customer distance equals radius', () => {
    const customerLocation = pointNorth(BASE, 1000);
    const exactRadiusKm =
      BranchServiceAreaService.distanceMeter(customerLocation, BASE) / 1000;

    const result = BranchServiceAreaService.evaluateBranch(
      branch(),
      [barber({ service_radius_km: exactRadiusKm })],
      customerLocation
    );

    expect(result.isWithinRadius).toBe(true);
    expect(result.distanceMeter).toBe(result.serviceRadiusMeter);
  });

  it('marks a branch unavailable when customer distance is greater than radius', () => {
    const result = BranchServiceAreaService.evaluateBranch(
      branch(),
      [barber()],
      pointNorth(BASE, 1001)
    );

    expect(result.isWithinRadius).toBe(false);
    expect(result.reason).toBe('OUTSIDE_SERVICE_RADIUS');
  });

  it('does not serve inactive branches', () => {
    const result = BranchServiceAreaService.evaluateBranch(
      branch({ is_active: false }),
      [barber()],
      pointNorth(BASE, 100)
    );

    expect(result.isWithinRadius).toBe(false);
    expect(result.reason).toBe('BRANCH_INACTIVE');
  });

  it('does not serve branches without valid coordinates', () => {
    const result = BranchServiceAreaService.evaluateBranch(
      branch({ latitude: null, longitude: null }),
      [barber()],
      pointNorth(BASE, 100)
    );

    expect(result.isWithinRadius).toBe(false);
    expect(result.reason).toBe('BRANCH_COORDINATE_INVALID');
  });

  it('does not serve branches whose barbers have empty or zero service radius', () => {
    const nullRadius = BranchServiceAreaService.evaluateBranch(
      branch(),
      [barber({ service_radius_km: null })],
      pointNorth(BASE, 100)
    );
    const zeroRadius = BranchServiceAreaService.evaluateBranch(
      branch(),
      [barber({ service_radius_km: 0 })],
      pointNorth(BASE, 100)
    );

    expect(nullRadius.isWithinRadius).toBe(false);
    expect(nullRadius.reason).toBe('NO_ACTIVE_BARBER_WITH_RADIUS');
    expect(zeroRadius.isWithinRadius).toBe(false);
    expect(zeroRadius.reason).toBe('NO_ACTIVE_BARBER_WITH_RADIUS');
  });

  it('rejects invalid swapped latitude and longitude values', () => {
    expect(() => normalizeLocation(106.813911, -6.260721)).toThrow(
      'latitude tidak valid'
    );
  });
});
