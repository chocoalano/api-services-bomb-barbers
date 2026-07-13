import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { appointments, branches, barbers, customers, payments, appointmentServices, services } from '../../../db/schema';
import { and, or, eq, inArray, gte, lt, like, asc, desc, sql, type SQL } from 'drizzle-orm';
import { getRbacProfile } from '../../../middleware/rbac';

const APPT_SORT_MAP: Record<string, any> = {
  scheduled_at: appointments.scheduledAt,
  created_at: appointments.createdAt,
  status: appointments.status,
  queue_position: appointments.queuePosition,
  completed_at: appointments.completedAt
};

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

const APPOINTMENT_STATUSES = [
  'pending', 'confirmed', 'in_queue', 'in_service', 'completed', 'cancelled', 'no_show'
] as const;
const APPOINTMENT_SOURCES = ['online_booking', 'walk_in'] as const;
const FULFILLMENT_TYPES = ['in_store', 'home_service'] as const;
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded'] as const;
const SORTABLE_COLUMNS = ['scheduled_at', 'created_at', 'status', 'queue_position', 'completed_at'] as const;
// Kolom tanggal yang boleh dipakai untuk filter rentang (dipilih dari UI).
const DATE_FIELDS = ['scheduled_at', 'created_at'] as const;
const resolveDateField = (raw: unknown): 'scheduled_at' | 'created_at' =>
  DATE_FIELDS.includes(raw as any) ? (raw as 'scheduled_at' | 'created_at') : 'scheduled_at';

// Memecah nilai query menjadi daftar unik yang tervalidasi terhadap whitelist.
const parseList = (raw: unknown, allowed: readonly string[]): string[] => {
  if (!raw) return [];
  const values = String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).filter((v) => allowed.includes(v));
};

const escapeLike = (value: string) => value.replace(/%/g, '\\%').replace(/_/g, '\\_');

const getJakartaDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const getPart = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: getPart('year'), month: getPart('month'), day: getPart('day') };
};

// Rentang [start, end) untuk satu hari kalender Asia/Jakarta dalam UTC ISO.
const jakartaDayBounds = (date: Date) => {
  const { year, month, day } = getJakartaDateParts(date);
  const start = new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
};

// Menormalkan input tanggal (YYYY-MM-DD atau ISO) menjadi ISO UTC.
// Untuk tanggal murni, awal hari memakai batas Jakarta; akhir hari eksklusif +1 hari.
const normalizeDate = (raw: unknown, edge: 'start' | 'end'): string | null => {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dateOnly) {
    const [y, m, d] = value.split('-').map(Number);
    const bounds = jakartaDayBounds(new Date(Date.UTC(y, m - 1, d, 12)));
    return edge === 'start' ? bounds.start : bounds.end;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

// Menyelesaikan cakupan cabang berdasarkan peran RBAC.
// Mengembalikan { scope, branchIds } di mana:
//  - 'all'      -> staff global (super_admin/HQ), tidak dibatasi cabang
//  - 'branches' -> dibatasi ke branchIds (branch_admin)
//  - 'none'     -> tidak punya cabang -> hasil kosong
type BranchScope =
  | { scope: 'all' }
  | { scope: 'branches'; branchIds: string[] }
  | { scope: 'none' };

const resolveBranchScope = async (staffId: string, requestedBranchId?: string): Promise<BranchScope> => {
  const profile = await getRbacProfile(staffId);
  if (profile.isGlobal) {
    // Super admin: boleh memilih satu cabang tertentu, atau semua.
    if (requestedBranchId) return { scope: 'branches', branchIds: [requestedBranchId] };
    return { scope: 'all' };
  }
  const allowed = profile.branchIds;
  if (allowed.length === 0) return { scope: 'none' };
  // Branch admin: hanya cabang miliknya. Jika minta cabang tertentu, harus dalam scope.
  if (requestedBranchId) {
    return allowed.includes(requestedBranchId)
      ? { scope: 'branches', branchIds: [requestedBranchId] }
      : { scope: 'none' };
  }
  return { scope: 'branches', branchIds: allowed };
};

export class AdminAppointmentListController {
  static async list({ query, staffId, set }: any) {
    try {
      const scope = await resolveBranchScope(staffId, query?.branch_id);

      const page = Math.max(Number(query?.page) || 1, 1);
      const perPage = Math.min(Math.max(Number(query?.per_page) || 20, 1), 100);
      const offset = (page - 1) * perPage;

      const statuses = parseList(query?.status, APPOINTMENT_STATUSES);
      const sources = parseList(query?.source, APPOINTMENT_SOURCES);
      const fulfillment = parseList(query?.fulfillment_type, FULFILLMENT_TYPES);
      const paymentStatuses = parseList(query?.payment_status, PAYMENT_STATUSES);
      const barberId = query?.barber_id ? String(query.barber_id) : null;
      const q = query?.q ? String(query.q).trim() : '';

      const dateField = resolveDateField(query?.date_field);
      const dateFrom = normalizeDate(query?.date_from, 'start');
      const dateTo = normalizeDate(query?.date_to, 'end');

      const sortColumn = SORTABLE_COLUMNS.includes(query?.sort) ? query.sort : 'scheduled_at';
      const ascending = String(query?.order || 'desc').toLowerCase() === 'asc';

      const emptyMeta = {
        total: 0, page, per_page: perPage, total_pages: 0,
        has_prev: false, has_next: false
      };

      if (scope.scope === 'none') {
        return createSuccessResponse('Daftar appointment', [], emptyMeta);
      }

      const dateCol = dateField === 'created_at' ? appointments.createdAt : appointments.scheduledAt;
      const conds: SQL[] = [];
      if (scope.scope === 'branches') conds.push(inArray(appointments.branchId, scope.branchIds));
      if (statuses.length > 0) conds.push(inArray(appointments.status, statuses as any));
      if (sources.length > 0) conds.push(inArray(appointments.source, sources as any));
      if (fulfillment.length > 0) conds.push(inArray(appointments.fulfillmentType, fulfillment));
      if (paymentStatuses.length > 0) conds.push(inArray(payments.status, paymentStatuses as any));
      if (barberId) conds.push(eq(appointments.barberId, barberId));
      if (dateFrom) conds.push(gte(dateCol, dateFrom));
      if (dateTo) conds.push(lt(dateCol, dateTo));
      if (q.length > 0) {
        const pattern = `%${escapeLike(q)}%`;
        conds.push(
          or(like(customers.fullName, pattern), like(customers.phone, pattern), like(customers.email, pattern))!
        );
      }
      const where = conds.length ? and(...conds) : undefined;

      // customers!inner saat pencarian nama; payments!inner saat filter status pembayaran.
      const customerJoinInner = q.length > 0;
      const paymentJoinInner = paymentStatuses.length > 0;

      const buildBase = (selection: any) => {
        let qb: any = db.select(selection).from(appointments);
        qb = customerJoinInner
          ? qb.innerJoin(customers, eq(appointments.customerId, customers.id))
          : qb.leftJoin(customers, eq(appointments.customerId, customers.id));
        qb = qb.leftJoin(branches, eq(appointments.branchId, branches.id));
        qb = qb.leftJoin(barbers, eq(appointments.barberId, barbers.id));
        qb = paymentJoinInner
          ? qb.innerJoin(payments, eq(payments.appointmentId, appointments.id))
          : qb.leftJoin(payments, eq(payments.appointmentId, appointments.id));
        return qb;
      };

      const sortCol = APPT_SORT_MAP[sortColumn] ?? appointments.scheduledAt;

      const [rows, countRows] = await Promise.all([
        buildBase({
          appt: appointments,
          branchId2: branches.id,
          branchName: branches.name,
          barberIdRef: barbers.id,
          barberDisplayName: barbers.displayName,
          barberLiveStatus: barbers.liveStatus,
          custId: customers.id,
          custFullName: customers.fullName,
          custPhone: customers.phone,
          custEmail: customers.email,
          payTotal: payments.totalAmount,
          payService: payments.serviceAmount,
          payProduct: payments.productAmount,
          payTip: payments.tipAmount,
          payDiscount: payments.discountAmount,
          payMethod: payments.method,
          payStatus: payments.status,
          payPaidAt: payments.paidAt
        })
          .where(where)
          // nullsFirst:false → NULL selalu di akhir.
          .orderBy(sql`${sortCol} IS NULL`, ascending ? asc(sortCol) : desc(sortCol))
          .limit(perPage)
          .offset(offset),
        buildBase({ count: sql<number>`count(*)` }).where(where)
      ]);

      const pageIds = rows.map((r: any) => r.appt.id);
      // Ambil appointment_services + services untuk halaman ini, lalu kelompokkan.
      const svcRows = pageIds.length
        ? await db
            .select({
              appointmentId: appointmentServices.appointmentId,
              id: appointmentServices.id,
              priceAmount: appointmentServices.priceAmount,
              durationMin: appointmentServices.durationMin,
              serviceId: services.id,
              serviceName: services.name
            })
            .from(appointmentServices)
            .leftJoin(services, eq(appointmentServices.serviceId, services.id))
            .where(inArray(appointmentServices.appointmentId, pageIds))
        : [];
      const svcByAppt: Record<string, any[]> = {};
      for (const s of svcRows) {
        (svcByAppt[s.appointmentId] ??= []).push({
          id: s.id,
          price_amount: s.priceAmount,
          duration_min: s.durationMin,
          services: s.serviceId ? { id: s.serviceId, name: s.serviceName } : null
        });
      }

      const data = rows.map((r: any) => ({
        ...snakeKeys(r.appt),
        branches: r.branchId2 ? { id: r.branchId2, name: r.branchName } : null,
        barbers: r.barberIdRef
          ? { id: r.barberIdRef, display_name: r.barberDisplayName, live_status: r.barberLiveStatus }
          : null,
        customers: r.custId
          ? { id: r.custId, full_name: r.custFullName, phone: r.custPhone, email: r.custEmail }
          : null,
        appointment_services: svcByAppt[r.appt.id] ?? [],
        payments:
          r.payStatus != null || r.payTotal != null
            ? [
                {
                  total_amount: r.payTotal,
                  service_amount: r.payService,
                  product_amount: r.payProduct,
                  tip_amount: r.payTip,
                  discount_amount: r.payDiscount,
                  method: r.payMethod,
                  status: r.payStatus,
                  paid_at: r.payPaidAt
                }
              ]
            : []
      }));

      const total = Number(countRows[0]?.count ?? 0);
      const totalPages = Math.ceil(total / perPage);

      return createSuccessResponse('Daftar appointment', data, {
        total,
        page,
        per_page: perPage,
        total_pages: totalPages,
        has_prev: page > 1,
        has_next: page < totalPages
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Gagal memuat daftar appointment');
    }
  }

  static async stats({ query, staffId, set }: any) {
    try {
      const scope = await resolveBranchScope(staffId, query?.branch_id);

      const zero = {
        total: 0, active: 0, in_service: 0, completed: 0,
        cancelled: 0, no_show: 0, walk_in: 0, online_booking: 0, home_service: 0
      };

      if (scope.scope === 'none') {
        return createSuccessResponse('Statistik appointment', zero);
      }

      // Default rentang = hari berjalan Asia/Jakarta, selaras dengan "Jadwal Hari Ini".
      const dateField = resolveDateField(query?.date_field);
      const hasExplicitRange = Boolean(query?.date_from || query?.date_to);
      const dateFrom = hasExplicitRange
        ? normalizeDate(query?.date_from, 'start')
        : jakartaDayBounds(new Date()).start;
      const dateTo = hasExplicitRange
        ? normalizeDate(query?.date_to, 'end')
        : jakartaDayBounds(new Date()).end;

      const dateCol = dateField === 'created_at' ? appointments.createdAt : appointments.scheduledAt;

      // Kondisi dasar (scope cabang + rentang tanggal) untuk tiap count.
      const baseConds: SQL[] = [];
      if (scope.scope === 'branches') baseConds.push(inArray(appointments.branchId, scope.branchIds));
      if (dateFrom) baseConds.push(gte(dateCol, dateFrom));
      if (dateTo) baseConds.push(lt(dateCol, dateTo));

      const countOf = async (extra?: SQL): Promise<number> => {
        const conds = extra ? [...baseConds, extra] : baseConds;
        const rows = await db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(conds.length ? and(...conds) : undefined);
        return Number(rows[0]?.count ?? 0);
      };

      const [
        total, active, inService, completed, cancelled, noShow, walkIn, online, homeService
      ] = await Promise.all([
        countOf(),
        countOf(inArray(appointments.status, ['pending', 'confirmed', 'in_queue'])),
        countOf(eq(appointments.status, 'in_service')),
        countOf(eq(appointments.status, 'completed')),
        countOf(eq(appointments.status, 'cancelled')),
        countOf(eq(appointments.status, 'no_show')),
        countOf(eq(appointments.source, 'walk_in')),
        countOf(eq(appointments.source, 'online_booking')),
        countOf(eq(appointments.fulfillmentType, 'home_service'))
      ]);

      return createSuccessResponse('Statistik appointment', {
        total,
        active,
        in_service: inService,
        completed,
        cancelled,
        no_show: noShow,
        walk_in: walkIn,
        online_booking: online,
        home_service: homeService
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Gagal memuat statistik appointment');
    }
  }
}
