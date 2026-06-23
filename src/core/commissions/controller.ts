import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { CommissionService } from './service';
import { supabase } from '../../lib/supabase';

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

  static async getCommissionDetail({ params, set }: any) {
    try {
      const { data, error } = await supabase
        .from('commission_entries')
        .select('*, commission_rules(*)')
        .eq('appointment_id', params.id)
        .single();
      
      if (error || !data) { set.status = 404; return createErrorResponse('Data komisi tidak ditemukan'); }
      return createSuccessResponse('Detail komisi', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getBarberCommissions({ staffId, query, set }: any) {
    try {
      const { data: barber } = await supabase
        .from('barbers')
        .select('id')
        .eq('staff_user_id', staffId)
        .single();
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
        supabase.from('barber_daily_stats').select('*', { count: 'exact', head: true }).eq('barber_id', barber.id),
        supabase.from('barber_daily_stats').select('*').eq('barber_id', barber.id).order('summary_date', { ascending: false }).range(offset, offset + limit - 1)
      ]);

      if (dataResult.error) throw new Error(dataResult.error.message);
      const total = countResult.count ?? 0;
      const rows = (dataResult.data ?? []).map((row: any) => ({
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
      const { data, error } = await supabase
        .from('daily_branch_summaries')
        .select('*')
        .eq('branch_id', params.branchId)
        .order('summary_date', { ascending: false });
        
      if (error) throw new Error(error.message);
      return createSuccessResponse('Laporan Bagi Hasil Cabang', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }
}
