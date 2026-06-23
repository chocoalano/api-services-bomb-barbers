import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { DashboardService } from './service';

export class DashboardController {
  // Admin Endpoints
  static async getAdminToday({ params, set }: any) {
    try {
      const res = await DashboardService.getAdminTodayDashboard(params.branchId);
      return createSuccessResponse('Dashboard Cabang Hari Ini', res);
    } catch (err: any) { set.status = 500; return createErrorResponse(err.message); }
  }

  static async getAdminSummary({ params, set }: any) {
    try {
      const res = await DashboardService.getBranchSummary(params.branchId);
      return createSuccessResponse('Summary Cabang', res);
    } catch (err: any) { set.status = 500; return createErrorResponse(err.message); }
  }

  // Barber Endpoints
  static async getBarberToday({ staffId, set }: any) {
    try {
      const res = await DashboardService.getBarberTodayDashboard(staffId);
      return createSuccessResponse('Dashboard Barber Hari Ini', res);
    } catch (err: any) { set.status = 500; return createErrorResponse(err.message); }
  }

  static async getBarberStats({ staffId, query, set }: any) {
    try {
      const res = await DashboardService.getBarberStats(staffId, query ?? {});
      return createSuccessResponse('Statistik Barber', res.data, res.meta);
    } catch (err: any) {
      set.status = err.message.includes('limit') || err.message.includes('page') ? 400 : 500;
      return createErrorResponse(err.message);
    }
  }

  // HQ Endpoints
  static async getHQToday({ set }: any) {
    try {
      const res = await DashboardService.getHQTodayDashboard();
      return createSuccessResponse('Dashboard Global Hari Ini', res);
    } catch (err: any) { set.status = 500; return createErrorResponse(err.message); }
  }

  static async getHQBranchSummary({ set }: any) {
    try {
      const res = await DashboardService.getHQBranchSummary();
      return createSuccessResponse('Summary Seluruh Cabang', res);
    } catch (err: any) { set.status = 500; return createErrorResponse(err.message); }
  }
}
