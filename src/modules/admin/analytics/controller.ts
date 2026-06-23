import { AnalyticsService } from './service';
import { createSuccessResponse, createErrorResponse } from '../../../shared/response';

const service = new AnalyticsService();

export class AnalyticsController {
  static async getBranchesAnalytics(ctx: any) {
    try {
      const data = await service.getBranchesAnalytics();
      return createSuccessResponse('Berhasil mengambil data analytics', data);
    } catch (e: any) {
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async exportRevenue(ctx: any) {
    try {
      const csv = await service.exportRevenueCSV(ctx.query || {});
      ctx.set.headers['Content-Type'] = 'text/csv';
      ctx.set.headers['Content-Disposition'] = 'attachment; filename="revenue_export.csv"';
      return csv;
    } catch (e: any) {
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async exportCommission(ctx: any) {
    try {
      const csv = await service.exportCommissionCSV(ctx.query || {});
      ctx.set.headers['Content-Type'] = 'text/csv';
      ctx.set.headers['Content-Disposition'] = 'attachment; filename="commission_export.csv"';
      return csv;
    } catch (e: any) {
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }
}
