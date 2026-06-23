import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { CustomerSearchService } from './service';

export class CustomerSearchController {
  static async searchCustomers({ query, set }: any) {
    try {
      const q = query?.q;
      const limit = query?.limit;

      if (!q || typeof q !== 'string' || q.trim().length === 0) {
        set.status = 400;
        return createErrorResponse('Parameter q wajib');
      }

      const customers = await CustomerSearchService.searchCustomers(q.trim(), limit);
      return createSuccessResponse('Daftar pelanggan', customers);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Terjadi kesalahan internal');
    }
  }
}
