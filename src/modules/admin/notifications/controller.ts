import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { NotificationSettingsService } from './service';

export class NotificationSettingsController {
  static async getSettings({ staffId, set }: any) {
    try {
      const settings = await NotificationSettingsService.getSettings(staffId);
      return createSuccessResponse('Pengaturan notifikasi', settings);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Terjadi kesalahan internal');
    }
  }

  static async updateSettings({ body, staffId, set }: any) {
    try {
      const settings = await NotificationSettingsService.updateSettings(staffId, body);
      return createSuccessResponse('Pengaturan notifikasi berhasil diperbarui', settings);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Terjadi kesalahan internal');
    }
  }
}
