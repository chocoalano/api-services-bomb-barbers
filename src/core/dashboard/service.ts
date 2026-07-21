import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import {
  appointments,
  payments,
  commissionEntries,
  barbers,
  dailyBranchSummaries,
  barberDailyStats,
  customers,
  branches,
  appointmentServices,
  services
} from '../../db/schema';
import { and, eq, inArray, gte, lt, desc, sql } from 'drizzle-orm';
import { BARBER_QUEUE_STATUSES, formatBarberQueueOrder } from '../appointments/service';

const DEFAULT_STATS_LIMIT = 30;
const MAX_STATS_LIMIT = 100;

const normalizeStatsLimit = (value: any): number => {
  if (value === undefined || value === null || value === '') return DEFAULT_STATS_LIMIT;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) throw new Error('Parameter limit harus berupa angka minimal 1');
  return Math.min(Math.floor(n), MAX_STATS_LIMIT);
};

const normalizeStatsPage = (value: any): number => {
  if (value === undefined || value === null || value === '') return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) throw new Error('Parameter page harus berupa angka minimal 1');
  return Math.floor(n);
};

const BARBER_PENDING_STATUSES = ['pending'];
const BARBER_ACTIVE_STATUSES = ['confirmed', 'in_queue', 'in_service'];
const JAKARTA_TIME_ZONE = 'Asia/Jakarta';
const CURRENT_ORDER_STATUS_PRIORITY: Record<string, number> = {
  in_service: 0,
  in_queue: 1,
  confirmed: 2,
  pending: 3
};

const unwrapRelation = (value: any) => Array.isArray(value) ? value[0] : value;

const getJakartaDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day')
  };
};

const compareNullableNumbers = (a: any, b: any) => {
  const first = Number(a);
  const second = Number(b);
  const firstValid = Number.isFinite(first);
  const secondValid = Number.isFinite(second);

  if (firstValid && secondValid) return first - second;
  if (firstValid) return -1;
  if (secondValid) return 1;
  return 0;
};

const compareNullableDates = (a?: string | null, b?: string | null) => {
  const first = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
  const second = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;

  return first - second;
};

export class DashboardService {
  // [REVISI C2] Seluruh metrik ringkasan dashboard dihitung on-the-fly dengan
  // batas waktu (di sini: hari berjalan Asia/Jakarta) sehingga counter otomatis
  // "reset" saat periode berganti — termasuk pergantian bulan — tanpa pernah
  // menghapus data mentah (appointments/payments/wallet_transactions tetap utuh).
  // Ringkasan tersimpan (daily_branch_summaries, barber_daily_stats) juga per-hari
  // dan dikembalikan sebagai daftar, bukan akumulasi sepanjang waktu.
  private static getTodayBounds() {
    const { year, month, day } = getJakartaDateParts(new Date());
    const start = new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    return { start: start.toISOString(), end: end.toISOString() };
  }

  private static sortCurrentOrders(a: any, b: any) {
    const firstPriority = CURRENT_ORDER_STATUS_PRIORITY[a.status] ?? 99;
    const secondPriority = CURRENT_ORDER_STATUS_PRIORITY[b.status] ?? 99;

    if (firstPriority !== secondPriority) return firstPriority - secondPriority;

    const queueComparison = compareNullableNumbers(a.queue_position, b.queue_position);
    if (queueComparison !== 0) return queueComparison;

    const scheduleComparison = compareNullableDates(a.scheduled_at, b.scheduled_at);
    if (scheduleComparison !== 0) return scheduleComparison;

    return compareNullableDates(a.created_at, b.created_at);
  }

  private static async getCurrentBarberOrder(barberId: string) {
    const rows = snakeKeys(
      await db
        .select({
          appt: {
            id: appointments.id,
            branch_id: appointments.branchId,
            customer_id: appointments.customerId,
            status: appointments.status,
            scheduled_at: appointments.scheduledAt,
            queue_position: appointments.queuePosition,
            created_at: appointments.createdAt,
            source: appointments.source,
            fulfillment_type: appointments.fulfillmentType,
            service_address: appointments.serviceAddress,
            destination_latitude: appointments.destinationLatitude,
            destination_longitude: appointments.destinationLongitude,
            location_notes: appointments.locationNotes,
            customer_media_urls: appointments.customerMediaUrls,
            journey_status: appointments.journeyStatus
          },
          custFullName: customers.fullName,
          branchName: branches.name,
          branchAddress: branches.address
        })
        .from(appointments)
        .leftJoin(customers, eq(appointments.customerId, customers.id))
        .leftJoin(branches, eq(appointments.branchId, branches.id))
        .where(and(eq(appointments.barberId, barberId), inArray(appointments.status, BARBER_QUEUE_STATUSES as any)))
    ) as any[];

    const apptIds = rows.map((r) => r.appt.id);
    const svcRows = apptIds.length
      ? await db
          .select({
            appointmentId: appointmentServices.appointmentId,
            price_amount: appointmentServices.priceAmount,
            serviceName: services.name
          })
          .from(appointmentServices)
          .leftJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(inArray(appointmentServices.appointmentId, apptIds))
      : [];
    const svcByAppt: Record<string, any[]> = {};
    for (const s of svcRows) {
      (svcByAppt[s.appointmentId] ??= []).push({ price_amount: s.price_amount, services: { name: s.serviceName } });
    }

    const currentOrder = rows
      .map((r) => ({
        ...r.appt,
        customers: r.cust_full_name != null ? { full_name: r.cust_full_name } : null,
        branches: r.branch_name != null ? { name: r.branch_name, address: r.branch_address } : null,
        appointment_services: svcByAppt[r.appt.id] ?? []
      }))
      .sort(this.sortCurrentOrders)[0];

    return currentOrder ? formatBarberQueueOrder(currentOrder) : null;
  }

  static async getAdminTodayDashboard(branchId: string) {
    const { start, end } = this.getTodayBounds();
    
    const apts = await db
      .select({ id: appointments.id, source: appointments.source, status: appointments.status, barber_id: appointments.barberId })
      .from(appointments)
      .where(and(eq(appointments.branchId, branchId), gte(appointments.createdAt, start), lt(appointments.createdAt, end)));
    const pays = await db
      .select({
        status: payments.status,
        total_amount: payments.totalAmount,
        service_amount: payments.serviceAmount,
        product_amount: payments.productAmount,
        tip_amount: payments.tipAmount
      })
      .from(payments)
      .where(and(eq(payments.branchId, branchId), gte(payments.createdAt, start), lt(payments.createdAt, end)));
    const commissions = await db
      .select({
        barber_share: commissionEntries.barberShare,
        branch_share: commissionEntries.branchShare,
        hq_share: commissionEntries.hqShare
      })
      .from(commissionEntries)
      .innerJoin(appointments, eq(commissionEntries.appointmentId, appointments.id))
      .where(and(eq(appointments.branchId, branchId), gte(commissionEntries.calculatedAt, start), lt(commissionEntries.calculatedAt, end)));

    return this.aggregateDashboard(apts, pays, commissions);
  }

  static async getBarberTodayDashboard(staffId: string) {
    const { start, end } = this.getTodayBounds();
    
    const [barber] = await db
      .select({ id: barbers.id, rating_avg: barbers.ratingAvg })
      .from(barbers)
      .where(eq(barbers.staffUserId, staffId))
      .limit(1);
    if (!barber) throw new Error('Profil Barber tidak ditemukan');
    const barberId = barber.id;

    const aptList = await db
      .select({ id: appointments.id, source: appointments.source, status: appointments.status, barber_id: appointments.barberId })
      .from(appointments)
      .where(and(eq(appointments.barberId, barberId), gte(appointments.createdAt, start), lt(appointments.createdAt, end)));
    // Query komisi dihapus bersama field pendapatan — barber tidak diizinkan
    // mengetahui nominalnya, jadi datanya tidak perlu diambil sama sekali.

    const completedApts = aptList.filter(a => a.status === 'completed');
    const pendingOrders = aptList.filter(a => BARBER_PENDING_STATUSES.includes(a.status)).length;
    const activeOrders = aptList.filter(a => BARBER_ACTIVE_STATUSES.includes(a.status)).length;
    const rating = Number(barber.rating_avg || 0);
    const currentOrder = await this.getCurrentBarberOrder(barberId);

    return {
      pending_orders: pendingOrders,
      active_orders: activeOrders,
      completed_today: completedApts.length,
      rating: Number.isFinite(rating) ? rating : 0,
      current_order: currentOrder,
      total_appointments: aptList.length,
      total_completed: completedApts.length,
      heads_count: completedApts.length
      // [KEBIJAKAN] Seluruh field nominal pendapatan sudah dilepas dari respons
      // ini: barber tidak diizinkan mengetahui pendapatannya. Metrik kinerja
      // (jumlah order, rating) tetap dikirim.
    };
  }

  static async getHQTodayDashboard() {
    const { start, end } = this.getTodayBounds();
    
    const apts = await db
      .select({ id: appointments.id, source: appointments.source, status: appointments.status, barber_id: appointments.barberId })
      .from(appointments)
      .where(and(gte(appointments.createdAt, start), lt(appointments.createdAt, end)));
    const pays = await db
      .select({
        status: payments.status,
        total_amount: payments.totalAmount,
        service_amount: payments.serviceAmount,
        product_amount: payments.productAmount,
        tip_amount: payments.tipAmount
      })
      .from(payments)
      .where(and(gte(payments.createdAt, start), lt(payments.createdAt, end)));
    const commissions = await db
      .select({ barber_share: commissionEntries.barberShare, branch_share: commissionEntries.branchShare, hq_share: commissionEntries.hqShare })
      .from(commissionEntries)
      .where(and(gte(commissionEntries.calculatedAt, start), lt(commissionEntries.calculatedAt, end)));

    return this.aggregateDashboard(apts, pays, commissions);
  }

  private static aggregateDashboard(apts: any[], payments: any[], commissions: any[]) {
    let bookingCount = 0;
    let walkInCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;

    apts.forEach(a => {
      if (a.source === 'online_booking') bookingCount++;
      if (a.source === 'walk_in') walkInCount++;
      if (a.status === 'completed') completedCount++;
      if (a.status === 'cancelled') cancelledCount++;
    });

    let totalRevenue = 0;
    let serviceRevenue = 0;
    let productRevenue = 0;
    let totalTip = 0;

    payments.filter(p => p.status === 'paid').forEach(p => {
      totalRevenue += Number(p.total_amount);
      serviceRevenue += Number(p.service_amount);
      productRevenue += Number(p.product_amount);
      totalTip += Number(p.tip_amount);
    });

    let barberShareTotal = 0;
    let branchShareTotal = 0;
    let hqShareTotal = 0;

    commissions.forEach(c => {
      barberShareTotal += Number(c.barber_share);
      branchShareTotal += Number(c.branch_share);
      hqShareTotal += Number(c.hq_share);
    });

    return {
      total_appointments: apts.length,
      booking_count: bookingCount,
      walk_in_count: walkInCount,
      total_completed: completedCount,
      total_cancelled: cancelledCount,
      revenue: {
        total: totalRevenue,
        service: serviceRevenue,
        product: productRevenue,
        tip: totalTip
      },
      shares: {
        barber: barberShareTotal,
        branch: branchShareTotal,
        hq: hqShareTotal
      }
    };
  }

  static async getBranchSummary(branchId: string) {
    return snakeKeys(
      await db
        .select()
        .from(dailyBranchSummaries)
        .where(eq(dailyBranchSummaries.branchId, branchId))
        .orderBy(desc(dailyBranchSummaries.summaryDate))
    );
  }

  static async getHQBranchSummary() {
    const rows = await db
      .select({ summary: dailyBranchSummaries, branchName: branches.name })
      .from(dailyBranchSummaries)
      .leftJoin(branches, eq(dailyBranchSummaries.branchId, branches.id))
      .orderBy(desc(dailyBranchSummaries.summaryDate));
    return rows.map((r) => ({
      ...snakeKeys(r.summary),
      branches: r.branchName != null ? { name: r.branchName } : null
    }));
  }

  static async getBarberStats(staffId: string, query: { page?: any; limit?: any } = {}) {
    const [barber] = await db.select({ id: barbers.id }).from(barbers).where(eq(barbers.staffUserId, staffId)).limit(1);
    if (!barber) throw new Error('Profil barber tidak ditemukan');
    const barberId = barber.id;

    const limit = normalizeStatsLimit(query.limit);
    const page = normalizeStatsPage(query.page);
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(barberDailyStats).where(eq(barberDailyStats.barberId, barberId)),
      db.select().from(barberDailyStats).where(eq(barberDailyStats.barberId, barberId)).orderBy(desc(barberDailyStats.summaryDate)).limit(limit).offset(offset)
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    // barber_daily_stats.commission_earned includes tip portion — alias for clarity
    const rows = snakeKeys(dataResult).map((row: any) => ({
      ...row,
      barber_share_including_tip: row.commission_earned
    }));

    return { data: rows, meta: { page, limit, total, total_pages: Math.ceil(total / limit) } };
  }
}
