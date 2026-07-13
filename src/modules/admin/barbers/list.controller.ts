import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { db } from '../../../lib/db';
import { appointments, barbers, staffUsers, branches } from '../../../db/schema';
import { and, eq, isNull, inArray, like, asc, desc, sql, type SQL } from 'drizzle-orm';
import { getRbacProfile } from '../../../middleware/rbac';

const LIVE_STATUSES = ['available', 'serving', 'on_break', 'offline'] as const;
const SORTABLE_COLUMNS = ['display_name', 'rating_avg', 'rating_count', 'created_at'] as const;
const ACTIVE_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];

const SORT_MAP = {
  display_name: barbers.displayName,
  rating_avg: barbers.ratingAvg,
  rating_count: barbers.ratingCount,
  created_at: barbers.createdAt
} as const;

const escapeLike = (value: string) => value.replace(/%/g, '\\%').replace(/_/g, '\\_');

const parseList = (raw: unknown, allowed: readonly string[]): string[] => {
  if (!raw) return [];
  return Array.from(
    new Set(String(raw).split(',').map((v) => v.trim()).filter(Boolean))
  ).filter((v) => allowed.includes(v));
};

// Barbers punya branch_id langsung, jadi scope cabang bisa difilter langsung.
type BarberScope = { scope: 'all' } | { scope: 'branches'; branchIds: string[] } | { scope: 'none' };

const resolveScope = async (staffId: string, requestedBranchId?: string): Promise<BarberScope> => {
  const profile = await getRbacProfile(staffId);
  if (profile.isGlobal) {
    if (requestedBranchId) return { scope: 'branches', branchIds: [requestedBranchId] };
    return { scope: 'all' };
  }
  if (profile.branchIds.length === 0) return { scope: 'none' };
  if (requestedBranchId) {
    return profile.branchIds.includes(requestedBranchId)
      ? { scope: 'branches', branchIds: [requestedBranchId] }
      : { scope: 'none' };
  }
  return { scope: 'branches', branchIds: profile.branchIds };
};

// Agregat appointment per barber: order aktif & total selesai.
const appointmentAggregates = async (
  barberIds: string[]
): Promise<Record<string, { active: number; completed: number }>> => {
  const out: Record<string, { active: number; completed: number }> = {};
  if (barberIds.length === 0) return out;

  const data = await db
    .select({ barber_id: appointments.barberId, status: appointments.status })
    .from(appointments)
    .where(inArray(appointments.barberId, barberIds));

  for (const row of data) {
    const id = row.barber_id as string;
    if (!id) continue;
    const agg = out[id] ?? (out[id] = { active: 0, completed: 0 });
    if (row.status === 'completed') agg.completed += 1;
    else if (ACTIVE_STATUSES.includes(row.status)) agg.active += 1;
  }
  return out;
};

export class AdminBarberListController {
  static async list({ query, staffId, set }: any) {
    try {
      const page = Math.max(Number(query?.page) || 1, 1);
      const perPage = Math.min(Math.max(Number(query?.per_page) || 20, 1), 100);
      const offset = (page - 1) * perPage;

      const q = query?.q ? String(query.q).trim() : '';
      const liveStatuses = parseList(query?.live_status, LIVE_STATUSES);
      const sortColumn = (SORTABLE_COLUMNS.includes(query?.sort) ? query.sort : 'display_name') as keyof typeof SORT_MAP;
      const ascending =
        String(query?.order || (sortColumn === 'display_name' ? 'asc' : 'desc')).toLowerCase() === 'asc';

      const emptyMeta = { total: 0, page, per_page: perPage, total_pages: 0, has_prev: false, has_next: false };
      const scope = await resolveScope(staffId, query?.branch_id);
      if (scope.scope === 'none') return createSuccessResponse('Daftar barber', [], emptyMeta);

      const conds: SQL[] = [isNull(barbers.deletedAt)];
      if (scope.scope === 'branches') conds.push(inArray(barbers.branchId, scope.branchIds));
      if (liveStatuses.length > 0) conds.push(inArray(barbers.liveStatus, liveStatuses));
      if (q.length > 0) conds.push(like(barbers.displayName, `%${escapeLike(q)}%`));
      const where = and(...conds);
      const sortCol = SORT_MAP[sortColumn];

      const [data, countRows] = await Promise.all([
        db
          .select({
            id: barbers.id,
            display_name: barbers.displayName,
            live_status: barbers.liveStatus,
            bio: barbers.bio,
            rating_avg: barbers.ratingAvg,
            rating_count: barbers.ratingCount,
            branch_id: barbers.branchId,
            created_at: barbers.createdAt,
            staffFullName: staffUsers.fullName,
            staffPhone: staffUsers.phone,
            staffEmail: staffUsers.email,
            branchId2: branches.id,
            branchName: branches.name
          })
          .from(barbers)
          .leftJoin(staffUsers, eq(barbers.staffUserId, staffUsers.id))
          .leftJoin(branches, eq(barbers.branchId, branches.id))
          .where(where)
          .orderBy(ascending ? asc(sortCol) : desc(sortCol))
          .limit(perPage)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(barbers).where(where)
      ]);

      const pageIds = data.map((b) => b.id);
      const apptStats = await appointmentAggregates(pageIds);

      const rows = data.map((b) => {
        const agg = apptStats[b.id] ?? { active: 0, completed: 0 };
        return {
          id: b.id,
          display_name: b.display_name,
          live_status: b.live_status ?? 'offline',
          bio: b.bio ?? null,
          rating_avg: Number(b.rating_avg ?? 0),
          rating_count: b.rating_count ?? 0,
          branch_id: b.branch_id,
          created_at: b.created_at,
          staff: { full_name: b.staffFullName, phone: b.staffPhone, email: b.staffEmail },
          branches: b.branchId2 ? { id: b.branchId2, name: b.branchName } : null,
          stats: { active_appointments: agg.active, completed_appointments: agg.completed }
        };
      });

      const total = Number(countRows[0]?.count ?? 0);
      const totalPages = Math.ceil(total / perPage);
      return createSuccessResponse('Daftar barber', rows, {
        total,
        page,
        per_page: perPage,
        total_pages: totalPages,
        has_prev: page > 1,
        has_next: page < totalPages
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Gagal memuat daftar barber');
    }
  }

  static async stats({ query, staffId, set }: any) {
    try {
      const zero = {
        total: 0, available: 0, serving: 0, on_break: 0, offline: 0, avg_rating: 0
      };
      const scope = await resolveScope(staffId, query?.branch_id);
      if (scope.scope === 'none') return createSuccessResponse('Statistik barber', zero);

      const scopeCond = scope.scope === 'branches' ? inArray(barbers.branchId, scope.branchIds) : undefined;

      const countOf = async (status?: string): Promise<number> => {
        const conds: SQL[] = [isNull(barbers.deletedAt)];
        if (scopeCond) conds.push(scopeCond);
        if (status) conds.push(eq(barbers.liveStatus, status));
        const rows = await db.select({ count: sql<number>`count(*)` }).from(barbers).where(and(...conds));
        return Number(rows[0]?.count ?? 0);
      };

      // Rata-rata rating dari barber dalam scope (jumlah barber kecil → aman diambil).
      const avgRating = async (): Promise<number> => {
        const conds: SQL[] = [isNull(barbers.deletedAt)];
        if (scopeCond) conds.push(scopeCond);
        const data = await db.select({ rating_avg: barbers.ratingAvg }).from(barbers).where(and(...conds));
        const vals = data.map((r) => Number(r.rating_avg ?? 0)).filter((n) => n > 0);
        if (vals.length === 0) return 0;
        return Number((vals.reduce((s, n) => s + n, 0) / vals.length).toFixed(2));
      };

      const [total, available, serving, onBreak, offline, avg] = await Promise.all([
        countOf(),
        countOf('available'),
        countOf('serving'),
        countOf('on_break'),
        countOf('offline'),
        avgRating()
      ]);

      return createSuccessResponse('Statistik barber', {
        total,
        available,
        serving,
        on_break: onBreak,
        offline,
        avg_rating: avg
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Gagal memuat statistik barber');
    }
  }
}
