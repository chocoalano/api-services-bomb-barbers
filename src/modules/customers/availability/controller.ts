import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { AvailabilityService } from './service';

const isBadRequest = (message: string) =>
  message.includes('wajib') ||
  message.includes('tidak valid') ||
  message.includes('Minimal') ||
  message.includes('slot_interval_min') ||
  message.includes('layanan');

export class AvailabilityController {
  static async getAvailableSlots({ params, query, set }: any) {
    try {
      const result = await AvailabilityService.getAvailableSlots(params.id, query);
      return createSuccessResponse('Slot jam tersedia berhasil diambil', result);
    } catch (error: any) {
      set.status = isBadRequest(error.message) ? 400 : 404;
      return createErrorResponse(error.message);
    }
  }
}
