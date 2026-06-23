import { supabase } from '../../lib/supabase';
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
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id,
        branch_id,
        customer_id,
        status,
        scheduled_at,
        queue_position,
        created_at,
        source,
        fulfillment_type,
        service_address,
        destination_latitude,
        destination_longitude,
        location_notes,
        customer_media_urls,
        journey_status,
        customers (
          full_name
        ),
        branches (
          name,
          address
        ),
        appointment_services (
          price_amount,
          services (
            name
          )
        )
      `)
      .eq('barber_id', barberId)
      .in('status', BARBER_QUEUE_STATUSES);

    if (error) {
      throw new Error('Gagal mengambil current order barber: ' + error.message);
    }

    const currentOrder = (data ?? [])
      .map((appointment: any) => ({
        ...appointment,
        customers: unwrapRelation(appointment.customers),
        branches: unwrapRelation(appointment.branches)
      }))
      .sort(this.sortCurrentOrders)[0];

    return currentOrder ? formatBarberQueueOrder(currentOrder) : null;
  }

  static async getAdminTodayDashboard(branchId: string) {
    const { start, end } = this.getTodayBounds();
    
    const { data: apts } = await supabase.from('appointments').select('id, source, status, barber_id').eq('branch_id', branchId).gte('created_at', start).lt('created_at', end);
    const { data: payments } = await supabase.from('payments').select('status, total_amount, service_amount, product_amount, tip_amount').eq('branch_id', branchId).gte('created_at', start).lt('created_at', end);
    const { data: commissions } = await supabase.from('commission_entries').select('*, appointments!inner(branch_id)').eq('appointments.branch_id', branchId).gte('calculated_at', start).lt('calculated_at', end);

    return this.aggregateDashboard(apts || [], payments || [], commissions || []);
  }

  static async getBarberTodayDashboard(staffId: string) {
    const { start, end } = this.getTodayBounds();
    
    const { data: barber } = await supabase
      .from('barbers')
      .select('id, rating_avg')
      .eq('staff_user_id', staffId)
      .single();
    if (!barber) throw new Error('Profil Barber tidak ditemukan');
    const barberId = barber.id;

    const { data: apts } = await supabase.from('appointments').select('id, source, status, barber_id').eq('barber_id', barberId).gte('created_at', start).lt('created_at', end);
    const { data: commissions } = await supabase.from('commission_entries').select('*, appointments!inner(barber_id)').eq('appointments.barber_id', barberId).gte('calculated_at', start).lt('calculated_at', end);

    const appointments = apts || [];
    const completedApts = appointments.filter(a => a.status === 'completed');
    const pendingOrders = appointments.filter(a => BARBER_PENDING_STATUSES.includes(a.status)).length;
    const activeOrders = appointments.filter(a => BARBER_ACTIVE_STATUSES.includes(a.status)).length;
    const barberEarning = (commissions || []).reduce((sum, c) => sum + Number(c.barber_share), 0);
    const barberTip = (commissions || []).reduce((sum, c) => sum + Number(c.tip_amount), 0);
    const rating = Number(barber.rating_avg || 0);
    const currentOrder = await this.getCurrentBarberOrder(barberId);

    return {
      pending_orders: pendingOrders,
      active_orders: activeOrders,
      completed_today: completedApts.length,
      rating: Number.isFinite(rating) ? rating : 0,
      current_order: currentOrder,
      total_appointments: appointments.length,
      total_completed: completedApts.length,
      heads_count: completedApts.length,
      // barber_share sudah mencakup porsi tip barber; beri nama eksplisit agar tidak ambigu
      barber_share_including_tip: barberEarning,
      tip_amount: barberTip,
      total_earnings: barberEarning
    };
  }

  static async getHQTodayDashboard() {
    const { start, end } = this.getTodayBounds();
    
    const { data: apts } = await supabase.from('appointments').select('id, source, status, barber_id').gte('created_at', start).lt('created_at', end);
    const { data: payments } = await supabase.from('payments').select('status, total_amount, service_amount, product_amount, tip_amount').gte('created_at', start).lt('created_at', end);
    const { data: commissions } = await supabase.from('commission_entries').select('*').gte('calculated_at', start).lt('calculated_at', end);

    return this.aggregateDashboard(apts || [], payments || [], commissions || []);
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
    const { data } = await supabase.from('daily_branch_summaries').select('*').eq('branch_id', branchId).order('summary_date', { ascending: false });
    return data || [];
  }

  static async getHQBranchSummary() {
    const { data } = await supabase.from('daily_branch_summaries').select('*, branches(name)').order('summary_date', { ascending: false });
    return data || [];
  }

  static async getBarberStats(staffId: string, query: { page?: any; limit?: any } = {}) {
    const { data: barber } = await supabase.from('barbers').select('id').eq('staff_user_id', staffId).single();
    if (!barber) throw new Error('Profil barber tidak ditemukan');
    const barberId = barber.id;

    const limit = normalizeStatsLimit(query.limit);
    const page = normalizeStatsPage(query.page);
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      supabase.from('barber_daily_stats').select('*', { count: 'exact', head: true }).eq('barber_id', barberId),
      supabase.from('barber_daily_stats').select('*').eq('barber_id', barberId).order('summary_date', { ascending: false }).range(offset, offset + limit - 1)
    ]);

    const total = countResult.count ?? 0;
    // barber_daily_stats.commission_earned includes tip portion — alias for clarity
    const rows = (dataResult.data ?? []).map((row: any) => ({
      ...row,
      barber_share_including_tip: row.commission_earned
    }));

    return { data: rows, meta: { page, limit, total, total_pages: Math.ceil(total / limit) } };
  }
}
