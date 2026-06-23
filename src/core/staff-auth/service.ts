import * as argon2 from 'argon2';
import { supabase } from '../../lib/supabase';

const DEFAULT_BARBER_RADIUS_KM = 5;

const unwrapRelation = (value: any) => Array.isArray(value) ? value[0] : value;

const isMissingRadiusColumnError = (error: any) =>
  Boolean(error?.message?.includes('service_radius_km') || error?.code === '42703');

const RBAC_SELECT = `
  staff_user_roles(
    branch_id,
    roles(
      name,
      role_permissions( permissions(code) )
    )
  )
`;

function flattenRbac(staff: any) {
  const roleRows: any[] = staff.staff_user_roles ?? [];
  const roles: string[] = [...new Set(roleRows.map((r: any) => r.roles?.name).filter(Boolean))];
  const permissions: string[] = [...new Set(
    roleRows.flatMap((r: any) =>
      ((r.roles?.role_permissions as any[]) ?? []).map((rp: any) => rp.permissions?.code).filter(Boolean)
    )
  )];
  const branchIds: string[] = [...new Set(roleRows.map((r: any) => r.branch_id).filter(Boolean))];
  const isGlobal = roleRows.some((r: any) => r.branch_id === null);
  return { roles, permissions, branchIds, isGlobal };
}

export class StaffAuthService {
  static async login(data: any) {
    const { email, password } = data;

    const { data: staff } = await supabase
      .from('staff_users')
      .select(`id, full_name, email, password_hash, is_active, deleted_at, ${RBAC_SELECT}`)
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle();

    if (!staff) throw new Error('Kredensial tidak valid');
    if (!staff.is_active || staff.deleted_at) throw new Error('Akun staff tidak aktif');
    if (!staff.password_hash) throw new Error('Kredensial tidak valid (akun lama tanpa kata sandi)');

    const isValid = await argon2.verify(staff.password_hash, password);
    if (!isValid) throw new Error('Kredensial tidak valid');

    return { id: staff.id, full_name: staff.full_name, email: staff.email, ...flattenRbac(staff) };
  }

  static async verifyRefresh(payload: any) {
    if (!payload || payload.role !== 'staff') {
      throw new Error('Refresh token tidak valid');
    }

    const { data: staff } = await supabase
      .from('staff_users')
      .select(`id, full_name, email, is_active, deleted_at, ${RBAC_SELECT}`)
      .eq('id', payload.sub)
      .is('deleted_at', null)
      .maybeSingle();

    if (!staff || !staff.is_active || staff.deleted_at) {
      throw new Error('Staff tidak aktif atau tidak ditemukan');
    }

    return { id: staff.id, full_name: staff.full_name, email: staff.email, ...flattenRbac(staff) };
  }

  static async getProfile(staffId: string) {
    const { data: staff } = await supabase
      .from('staff_users')
      .select('id, full_name, email, phone, is_active, created_at')
      .eq('id', staffId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!staff) {
      throw new Error('Staff tidak ditemukan');
    }

    let { data: barber, error: barberError }: { data: any; error: any } = await supabase
      .from('barbers')
      .select('id, display_name, branch_id, rating_avg, rating_count, live_status, service_radius_km')
      .eq('staff_user_id', staffId)
      .is('deleted_at', null)
      .maybeSingle();

    if (barberError && isMissingRadiusColumnError(barberError)) {
      const fallback = await supabase
        .from('barbers')
        .select('id, display_name, branch_id, rating_avg, rating_count, live_status')
        .eq('staff_user_id', staffId)
        .is('deleted_at', null)
        .maybeSingle();

      barber = fallback.data;
      barberError = fallback.error;
    }

    if (barberError) {
      throw new Error('Gagal mengambil profil barber: ' + barberError.message);
    }

    let branch = null;
    if (barber?.branch_id) {
      const { data: branchData } = await supabase
        .from('branches')
        .select('id, name, address, region_id, regions(name)')
        .eq('id', barber.branch_id)
        .maybeSingle();

      branch = branchData;
    }

    const region = unwrapRelation((branch as any)?.regions);
    const radiusKm = Number((barber as any)?.service_radius_km ?? DEFAULT_BARBER_RADIUS_KM);
    const ratingAvg = Number((barber as any)?.rating_avg ?? 0);
    const ratingCount = Number((barber as any)?.rating_count ?? 0);

    return {
      ...staff,
      name: barber?.display_name || staff.full_name,
      branch_area: branch?.name || region?.name || branch?.address || '',
      radius_km: Number.isFinite(radiusKm) ? radiusKm : DEFAULT_BARBER_RADIUS_KM,
      rating_avg: Number.isFinite(ratingAvg) ? ratingAvg : 0,
      rating_count: Number.isFinite(ratingCount) ? ratingCount : 0,
      barber: barber ? {
        id: barber.id,
        display_name: barber.display_name,
        rating_avg: Number.isFinite(ratingAvg) ? ratingAvg : 0,
        rating_count: Number.isFinite(ratingCount) ? ratingCount : 0,
        live_status: barber.live_status ?? 'offline',
        branch: branch ? {
          id: branch.id,
          name: branch.name,
          address: branch.address ?? null,
          region_name: region?.name ?? null
        } : null
      } : null
    };
  }
}
