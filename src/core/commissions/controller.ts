import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { CommissionService } from './service';
import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { commissionEntries, commissionRules, barbers, barberDailyStats, dailyBranchSummaries, appointments } from '../../db/schema';
import { and, eq, desc, isNull, sql } from 'drizzle-orm';

export class CommissionController {
  static async calculateCommission({ params, set }: any) {
    try {
      const res = await CommissionService.calculateCommission(params.id);
      set.status = 201;
      return createSuccessResponse('Komisi berhasil dihitung', res);
    } catch (err: any) {
      if (err.message.includes('Idempotency')) set.status = 409;
      else set.status = 400;
      return createErrorResponse(err.message);
    }
  }

  /**
   * Laporan "order selesai tanpa komisi". Sejak komisi dicatat otomatis lewat job
   * COMMISSION_CALCULATE, kegagalan permanen (mis. tidak ada aturan komisi aktif)
   * tidak terlihat siapa pun. Endpoint ini membuatnya kelihatan agar bisa
   * ditindaklanjuti — tanpa ini, temuan A1 hanya berpindah bentuk.
   */
  static async getMissingCommissions({ query, set }: any) {
    try {
      const limit = Math.min(Number(query?.limit) || 50, 200);
      const rows = await db
        .select({
          appointment_id: appointments.id,
          branch_id: appointments.branchId,
          barber_id: appointments.barberId,
          scheduled_at: appointments.scheduledAt,
          updated_at: appointments.updatedAt
        })
        .from(appointments)
        .leftJoin(commissionEntries, eq(commissionEntries.appointmentId, appointments.id))
        .where(and(eq(appointments.status, 'completed'), isNull(commissionEntries.id)))
        .orderBy(desc(appointments.updatedAt))
        .limit(limit);

      return createSuccessResponse('Order selesai yang belum memiliki komisi', snakeKeys(rows));
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getCommissionDetail({ params, set }: any) {
    try {
      const [row] = await db
        .select({ entry: commissionEntries, rule: commissionRules })
        .from(commissionEntries)
        .leftJoin(commissionRules, eq(commissionEntries.commissionRuleId, commissionRules.id))
        .where(eq(commissionEntries.appointmentId, params.id))
        .limit(1);

      if (!row) { set.status = 404; return createErrorResponse('Data komisi tidak ditemukan'); }
      const data = { ...snakeKeys(row.entry), commission_rules: row.rule ? snakeKeys(row.rule) : null };
      return createSuccessResponse('Detail komisi', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getBarberCommissions({ staffId, query, set }: any) {
    try {
      const [barber] = await db
        .select({ id: barbers.id })
        .from(barbers)
        .where(eq(barbers.staffUserId, staffId))
        .limit(1);
      if (!barber) {
        set.status = 403;
        return createErrorResponse('Profil barber tidak ditemukan');
      }

      const DEFAULT_LIMIT = 30;
      const MAX_LIMIT = 100;
      const rawLimit = query?.limit;
      const rawPage = query?.page;

      const limit = (() => {
        if (rawLimit === undefined || rawLimit === null || rawLimit === '') return DEFAULT_LIMIT;
        const n = Number(rawLimit);
        if (!Number.isFinite(n) || n < 1) throw new Error('Parameter limit harus berupa angka minimal 1');
        return Math.min(Math.floor(n), MAX_LIMIT);
      })();
      const page = (() => {
        if (rawPage === undefined || rawPage === null || rawPage === '') return 1;
        const n = Number(rawPage);
        if (!Number.isFinite(n) || n < 1) throw new Error('Parameter page harus berupa angka minimal 1');
        return Math.floor(n);
      })();
      const offset = (page - 1) * limit;

      const [countResult, dataResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(barberDailyStats).where(eq(barberDailyStats.barberId, barber.id)),
        db.select().from(barberDailyStats).where(eq(barberDailyStats.barberId, barber.id)).orderBy(desc(barberDailyStats.summaryDate)).limit(limit).offset(offset)
      ]);

      const total = Number(countResult[0]?.count ?? 0);
      const rows = snakeKeys(dataResult).map((row: any) => ({
        ...row,
        barber_share_including_tip: row.commission_earned
      }));
      return createSuccessResponse('Laporan Komisi Barber Harian', rows, { page, limit, total, total_pages: Math.ceil(total / limit) });
    } catch (err: any) {
      set.status = err.message.includes('limit') || err.message.includes('page') ? 400 : 500;
      return createErrorResponse(err.message);
    }
  }

  static async getBranchCommissions({ params, set }: any) {
    try {
      const data = snakeKeys(
        await db
          .select()
          .from(dailyBranchSummaries)
          .where(eq(dailyBranchSummaries.branchId, params.branchId))
          .orderBy(desc(dailyBranchSummaries.summaryDate))
      );
      return createSuccessResponse('Laporan Bagi Hasil Cabang', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }
}
