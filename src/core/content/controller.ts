import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { ContentService } from './service';

const isBadRequest = (message: string) =>
  message.includes('Parameter') || message.includes('wajib');

export class ContentController {
  static async getBanners({ query, set }: any) {
    try {
      const banners = await ContentService.getActiveBanners(query);
      return createSuccessResponse('Daftar banner berhasil diambil', banners);
    } catch (error: any) {
      set.status = isBadRequest(error.message) ? 400 : 500;
      return createErrorResponse(error.message);
    }
  }

  static async getGallery({ query, set }: any) {
    try {
      const gallery = await ContentService.getAfterGallery(query);
      return createSuccessResponse('Gallery layanan berhasil diambil', gallery);
    } catch (error: any) {
      set.status = isBadRequest(error.message) ? 400 : 500;
      return createErrorResponse(error.message);
    }
  }

  static async getCustomerNotifications({ customerId, query, set }: any) {
    try {
      const notifications = await ContentService.getCustomerNotifications(customerId, query);
      return createSuccessResponse('Daftar notifikasi berhasil diambil', notifications);
    } catch (error: any) {
      set.status = isBadRequest(error.message) ? 400 : 500;
      return createErrorResponse(error.message);
    }
  }

  static async markNotificationRead({ params, customerId, set }: any) {
    try {
      const result = await ContentService.markNotificationRead(customerId, params.id);
      return createSuccessResponse('Notifikasi ditandai sudah dibaca', result);
    } catch (error: any) {
      set.status = error.message.includes('tidak ditemukan') ? 404 : 500;
      return createErrorResponse(error.message);
    }
  }

  static async markAllNotificationsRead({ customerId, set }: any) {
    try {
      const result = await ContentService.markAllNotificationsRead(customerId);
      return createSuccessResponse('Semua notifikasi ditandai sudah dibaca', result);
    } catch (error: any) {
      set.status = 500;
      return createErrorResponse(error.message);
    }
  }
}
