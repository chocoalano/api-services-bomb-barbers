import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import {
  dailyBranchSummaries,
  branches,
  invoices,
  payments,
  commissionEntries,
  appointments,
  barbers
} from '../../../db/schema';
import { and, eq, gte, lte, desc, type SQL } from 'drizzle-orm';

export class AnalyticsService {
  async getBranchesAnalytics() {
    const rows = await db
      .select({ summary: dailyBranchSummaries, branchName: branches.name })
      .from(dailyBranchSummaries)
      .leftJoin(branches, eq(dailyBranchSummaries.branchId, branches.id))
      .orderBy(desc(dailyBranchSummaries.summaryDate))
      .limit(100);

    return rows.map((r) => ({
      ...snakeKeys(r.summary),
      branch: r.branchName != null ? { name: r.branchName } : null
    }));
  }

  async exportRevenueCSV(query: { start_date?: string; end_date?: string; branch_id?: string }) {
    const conds: SQL[] = [];
    if (query.start_date) conds.push(gte(invoices.createdAt, query.start_date));
    if (query.end_date) conds.push(lte(invoices.createdAt, query.end_date));
    if (query.branch_id) conds.push(eq(payments.branchId, query.branch_id));

    const rows = await db
      .select({
        id: invoices.id,
        appointmentId: payments.appointmentId,
        branchName: branches.name,
        totalAmount: payments.totalAmount,
        createdAt: invoices.createdAt
      })
      .from(invoices)
      .leftJoin(payments, eq(invoices.paymentId, payments.id))
      .leftJoin(branches, eq(payments.branchId, branches.id))
      .where(conds.length ? and(...conds) : undefined);

    const headers = ['Invoice ID', 'Appointment ID', 'Branch Name', 'Total Amount', 'Created At'];
    const csvRows = rows.map((r) => [
      r.id,
      r.appointmentId,
      r.branchName || 'N/A',
      r.totalAmount,
      r.createdAt
    ]);

    return [headers, ...csvRows].map((e) => e.join(',')).join('\n');
  }

  async exportCommissionCSV(query: { start_date?: string; end_date?: string; barber_id?: string }) {
    const conds: SQL[] = [];
    if (query.start_date) conds.push(gte(commissionEntries.createdAt, query.start_date));
    if (query.end_date) conds.push(lte(commissionEntries.createdAt, query.end_date));
    if (query.barber_id) conds.push(eq(appointments.barberId, query.barber_id));

    const rows = await db
      .select({
        id: commissionEntries.id,
        barberName: barbers.displayName,
        baseAmount: commissionEntries.baseAmount,
        barberShare: commissionEntries.barberShare,
        tipAmount: commissionEntries.tipAmount,
        createdAt: commissionEntries.createdAt
      })
      .from(commissionEntries)
      .leftJoin(appointments, eq(commissionEntries.appointmentId, appointments.id))
      .leftJoin(barbers, eq(appointments.barberId, barbers.id))
      .where(conds.length ? and(...conds) : undefined);

    const headers = ['ID', 'Barber Name', 'Base Amount', 'Barber Share', 'Tip', 'Created At'];
    const csvRows = rows.map((r) => [
      r.id,
      r.barberName || 'N/A',
      r.baseAmount,
      r.barberShare,
      r.tipAmount,
      r.createdAt
    ]);

    return [headers, ...csvRows].map((e) => e.join(',')).join('\n');
  }
}
