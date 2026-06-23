import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { CatalogService } from './service';
import { redis, getBarberStatusKey } from '../../../lib/redis';

export class CatalogController {
  static async getBranches({ set }: any) {
    try {
      const branches = await CatalogService.getBranches();
      return createSuccessResponse('Daftar cabang berhasil diambil', branches);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getBranchDetail({ params, set }: any) {
    try {
      const branch = await CatalogService.getBranchDetail(params.id);
      return createSuccessResponse('Detail cabang berhasil diambil', branch);
    } catch (err: any) {
      set.status = 404;
      return createErrorResponse(err.message);
    }
  }

  static async getBranchBarbers({ params, set }: any) {
    try {
      const barbers = await CatalogService.getBranchBarbers(params.id);
      
      const enrichedBarbers = await Promise.all(barbers.map(async (b: any) => {
        const status = await redis.get(getBarberStatusKey(b.id));
        return {
          ...b,
          live_status: status || 'available'
        };
      }));

      return createSuccessResponse('Daftar barber berhasil diambil', enrichedBarbers);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }

  static async getBranchServices({ params, query, set }: any) {
    try {
      const services = await CatalogService.getBranchServices(params.id, query);
      return createSuccessResponse('Daftar layanan berhasil diambil', services);
    } catch (err: any) {
      if (err.message.includes('limit') || err.message.includes('page')) {
        set.status = 400;
      } else if (err.message.includes('Cabang tidak ditemukan')) {
        set.status = 404;
      } else {
        set.status = 500;
      }
      return createErrorResponse(err.message);
    }
  }

  static async resolveServicePrice({ params, set }: any) {
    try {
      const price = await CatalogService.resolveServicePrice(params.serviceId, params.id);
      return createSuccessResponse('Harga layanan berhasil diresolusi', price);
    } catch (err: any) {
      set.status = 404;
      return createErrorResponse(err.message);
    }
  }
}
