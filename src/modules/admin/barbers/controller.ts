import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { AdminBarbersService } from './service';
import { AuditService } from '../audit/service';

export class AdminBarbersController {
  static async listBarbers({ params, set }: any) {
    try {
      const data = await AdminBarbersService.listBranchBarbers(params.branchId);
      return createSuccessResponse('Daftar barber cabang', data);
    } catch (err: any) {
      set.status = err.status || 500;
      return createErrorResponse(err.message);
    }
  }

  static async getSchedule({ params, query, set }: any) {
    try {
      const date = query.date || new Date().toISOString().slice(0, 10);
      const data = await AdminBarbersService.getBarberSchedule(
        params.barberId, params.branchId, date
      );
      return createSuccessResponse('Jadwal barber', data);
    } catch (err: any) {
      set.status = err.status || 500;
      return createErrorResponse(err.message);
    }
  }

  static async setStatus({ params, body, staffId, set }: any) {
    try {
      const data = await AdminBarbersService.setBarberStatus(
        params.barberId, params.branchId, body?.status
      );
      await AuditService.logAction(
        'admin', staffId, 'SET_BARBER_STATUS', 'barbers', params.barberId,
        null, { status: body?.status }, params.branchId
      );
      return createSuccessResponse('Status barber berhasil diubah', data);
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }
}
