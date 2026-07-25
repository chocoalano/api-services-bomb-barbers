import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { db } from '../../../lib/db';
import { customers, appointments, payments } from '../../../db/schema';
import { and, or, eq, isNull, isNotNull, inArray, like, asc, desc, gte, sql, type SQL } from 'drizzle-orm';
import { getRbacProfile } from '../../../middleware/rbac';

const SORTABLE_COLUMNS = ['full_name', 'created_at', 'points_balance'] as const;

const SORT_MAP = {
  full_name: customers.fullName,
  created_at: customers.createdAt,
  points_balance: customers.pointsBalance
} as const;

const escapeLike = (value: string) => value.replace(/%/g, '\\%').replace(/_/g, '\\_');

type CustomerScope =
  | { scope: 'all' }
  | { scope: 'ids'; ids: string[] } // branch_admin: customer yang punya appointment di cabangnya
  | { scope: 'none' };

// Kumpulkan customer_id unik yang pernah punya appointment di cabang yang diizinkan.
const scopedCustomerIds = async (branchIds: string[]): Promise<string[]> => {
  if (branchIds.length === 0) return [];
  const ids = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const data = await db
      .select({ customer_id: appointments.customerId })
      .from(appointments)
      .where(and(inArray(appointments.branchId, branchIds), isNotNull(appointments.customerId)))
      .limit(pageSize)
      .offset(from);
    for (const row of data) if (row.customer_id) ids.add(row.customer_id);
    if (data.length < pageSize) break;
  }
  return [...ids];
};

const resolveScope = async (staffId: string): Promise<CustomerScope> => {
  const profile = await getRbacProfile(staffId);
  if (profile.isGlobal) return { scope: 'all' };
  if (profile.branchIds.length === 0) return { scope: 'none' };
  const ids = await scopedCustomerIds(profile.branchIds);
  return ids.length ? { scope: 'ids', ids } : { scope: 'none' };
};

// Agregat appointment per customer (jumlah, selesai, kunjungan terakhir), di-scope cabang.
const appointmentAggregates = async (
  customerIds: string[],
  branchIds: string[] | null
): Promise<Record<string, { total: number; completed: number; last_visit_at: string | null }>> => {
  const out: Record<string, { total: number; completed: number; last_visit_at: string | null }> = {};
  if (customerIds.length === 0) return out;

  const conds: SQL[] = [inArray(appointments.customerId, customerIds)];
  if (branchIds) conds.push(inArray(appointments.branchId, branchIds));

  const data = await db
    .select({
      customer_id: appointments.customerId,
      status: appointments.status,
      scheduled_at: appointments.scheduledAt,
      completed_at: appointments.completedAt
    })
    .from(appointments)
    .where(and(...conds));

  for (const row of data) {
    const id = row.customer_id as string;
    if (!id) continue;
    const agg = out[id] ?? (out[id] = { total: 0, completed: 0, last_visit_at: null });
    agg.total += 1;
    if (row.status === 'completed') agg.completed += 1;
    const visit = row.completed_at ?? row.scheduled_at ?? null;
    if (visit && (!agg.last_visit_at || visit > agg.last_visit_at)) agg.last_visit_at = visit;
  }
  return out;
};

// Total belanja (pembayaran lunas) per customer, di-scope cabang.
const spentAggregates = async (
  customerIds: string[],
  branchIds: string[] | null
): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  if (customerIds.length === 0) return out;

  const conds: SQL[] = [eq(payments.status, 'paid'), inArray(appointments.customerId, customerIds)];
  if (branchIds) conds.push(inArray(payments.branchId, branchIds));

  const data = await db
    .select({ total_amount: payments.totalAmount, customer_id: appointments.customerId })
    .from(payments)
    .innerJoin(appointments, eq(payments.appointmentId, appointments.id))
    .where(and(...conds));

  for (const row of data) {
    const id = row.customer_id as string | undefined;
    if (!id) continue;
    out[id] = (out[id] ?? 0) + (row.total_amount ?? 0);
  }
  return out;
};

export class AdminCustomerListController {
  static async list({ query, staffId, set }: any) {
    try {
      const page = Math.max(Number(query?.page) || 1, 1);
      const perPage = Math.min(Math.max(Number(query?.per_page) || 20, 1), 100);
      const offset = (page - 1) * perPage;

      const q = query?.q ? String(query.q).trim() : '';
      const status = query?.status === 'active' || query?.status === 'inactive' ? query.status : '';
      const sortColumn = (SORTABLE_COLUMNS.includes(query?.sort) ? query.sort : 'full_name') as keyof typeof SORT_MAP;
      const ascending = String(query?.order || (sortColumn === 'full_name' ? 'asc' : 'desc')).toLowerCase() === 'asc';

      const emptyMeta = { total: 0, page, per_page: perPage, total_pages: 0, has_prev: false, has_next: false };

      const scope = await resolveScope(staffId);
      if (scope.scope === 'none') {
        return createSuccessResponse('Daftar pelanggan', [], emptyMeta);
      }

      const conds: SQL[] = [isNull(customers.deletedAt)];
      if (scope.scope === 'ids') conds.push(inArray(customers.id, scope.ids));
      if (status === 'active') conds.push(eq(customers.isActive, true));
      if (status === 'inactive') conds.push(eq(customers.isActive, false));
      if (q.length > 0) {
        const pattern = `%${escapeLike(q)}%`;
        conds.push(
          or(like(customers.fullName, pattern), like(customers.phone, pattern), like(customers.email, pattern))!
        );
      }
      const where = and(...conds);
      const sortCol = SORT_MAP[sortColumn];

      const [data, countRows] = await Promise.all([
        db
          .select({
            id: customers.id,
            full_name: customers.fullName,
            phone: customers.phone,
            email: customers.email,
            points_balance: customers.pointsBalance,
            is_active: customers.isActive,
            created_at: customers.createdAt
          })
          .from(customers)
          .where(where)
          .orderBy(ascending ? asc(sortCol) : desc(sortCol))
          .limit(perPage)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(customers).where(where)
      ]);

      const pageIds = data.map((c) => c.id);
      const scopeBranchIds = scope.scope === 'ids' ? await currentBranchIds(staffId) : null;

      const [apptStats, spentMap] = await Promise.all([
        appointmentAggregates(pageIds, scopeBranchIds),
        spentAggregates(pageIds, scopeBranchIds)
      ]);

      const rows = data.map((c) => {
        const a = apptStats[c.id] ?? { total: 0, completed: 0, last_visit_at: null };
        return {
          ...c,
          stats: {
            total_appointments: a.total,
            completed_appointments: a.completed,
            last_visit_at: a.last_visit_at,
            total_spent: spentMap[c.id] ?? 0
          }
        };
      });

      const total = Number(countRows[0]?.count ?? 0);
      const totalPages = Math.ceil(total / perPage);
      return createSuccessResponse('Daftar pelanggan', rows, {
        total,
        page,
        per_page: perPage,
        total_pages: totalPages,
        has_prev: page > 1,
        has_next: page < totalPages
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Gagal memuat daftar pelanggan');
    }
  }

  static async stats({ staffId, set }: any) {
    try {
      const zero = { total: 0, active: 0, inactive: 0, new_30d: 0 };
      const scope = await resolveScope(staffId);
      if (scope.scope === 'none') return createSuccessResponse('Statistik pelanggan', zero);

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Hitung dengan filter, dibatasi ke scope (super_admin: semua; branch_admin: id cabangnya).
      const countWith = async (extra?: SQL): Promise<number> => {
        const conds: SQL[] = [isNull(customers.deletedAt)];
        if (scope.scope === 'ids') conds.push(inArray(customers.id, scope.ids));
        if (extra) conds.push(extra);
        const rows = await db.select({ count: sql<number>`count(*)` }).from(customers).where(and(...conds));
        return Number(rows[0]?.count ?? 0);
      };

      const [total, active, inactive, new30d] = await Promise.all([
        countWith(),
        countWith(eq(customers.isActive, true)),
        countWith(eq(customers.isActive, false)),
        countWith(gte(customers.createdAt, since))
      ]);

      return createSuccessResponse('Statistik pelanggan', {
        total,
        active,
        inactive,
        new_30d: new30d
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Gagal memuat statistik pelanggan');
    }
  }
}

// Cabang yang menjadi scope staff (untuk membatasi agregat branch_admin).
const currentBranchIds = async (staffId: string): Promise<string[] | null> => {
  const profile = await getRbacProfile(staffId);
  return profile.isGlobal ? null : profile.branchIds;
};
