import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { CatalogService } from './service';
import { isIdleLiveStatus, normalizeLiveStatus } from '../../../config/booking';

export class CatalogController {
  static async getBranches({ query, headers, set }: any) {
    try {
      const branches = await CatalogService.getBranches(query ?? {}, {
        requestId: headers?.['x-request-id'] ?? null
      });
      return createSuccessResponse('Daftar cabang berhasil diambil', branches);
    } catch (err: any) {
      set.status = err.status || 500;
      return createErrorResponse(err.message, err.errors ?? null, err.code ?? null, err.data ?? null);
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

  static async getBranchBarbers({ params, query, headers, set }: any) {
    try {
      const barbers = await CatalogService.getBranchBarbers(params.id, query ?? {}, {
        requestId: headers?.['x-request-id'] ?? null
      });
      
      // [E8] Dulu status dibaca dari Redis dengan fallback literal 'available',
      // sehingga barber tanpa entri cache SELALU tampak online di katalog —
      // termasuk yang offline atau sedang cuti. DB adalah sumber kebenaran.
      //
      // Daftar memuat SEMUA barber cabang (termasuk yang offline/serving) agar
      // app bisa menampilkan badge kehadiran realtime. `is_online` diturunkan di
      // sini dengan predikat yang sama seperti aturan booking, supaya app tidak
      // perlu menyalin kamus status dan tidak bisa berbeda dari backend.
      const enrichedBarbers = barbers.map((b: any) => {
        const liveStatus = normalizeLiveStatus(b.live_status);
        return {
          ...b,
          live_status: liveStatus,
          is_online: isIdleLiveStatus(liveStatus)
        };
      });

      return createSuccessResponse('Daftar barber berhasil diambil', enrichedBarbers);
    } catch (err: any) {
      set.status = err.status || 500;
      return createErrorResponse(err.message, err.errors ?? null, err.code ?? null, err.data ?? null);
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
      return createErrorResponse(err.message, err.errors ?? null, err.code ?? null, err.data ?? null);
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
