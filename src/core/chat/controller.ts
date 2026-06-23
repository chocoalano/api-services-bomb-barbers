import { ChatService } from './service';
import { createSuccessResponse, createErrorResponse } from '../../shared/response';

const service = new ChatService();

export class ChatController {
  // Middleware customerAuthMiddleware meng-inject customerId; staffAuthMiddleware
  // meng-inject staffId. Controller cukup pakai nilai tersebut tanpa decode JWT ulang.

  static async getChatHistory({ params, query, customerId, staffId, set }: any) {
    try {
      const appointmentId = params.id;
      const actorId: string = customerId ?? staffId;
      const actorRole: 'customer' | 'barber' = customerId ? 'customer' : 'barber';

      const data = await service.getChatHistory(appointmentId, actorId, actorRole, query);
      return createSuccessResponse('Riwayat chat berhasil diambil', data);
    } catch (e: any) {
      if (e.message.includes('Akses ditolak') || e.message.includes('Appointment tidak ditemukan') || e.message.includes('Parameter')) {
        set.status = 400;
        return createErrorResponse('Bad Request', e.message);
      }
      set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async sendMessage({ params, body, customerId, staffId, set }: any) {
    try {
      const appointmentId = params.id;
      const actorId: string = customerId ?? staffId;
      const actorRole: 'customer' | 'barber' = customerId ? 'customer' : 'barber';
      const text = body.text ?? body.message;

      const data = await service.saveMessage(appointmentId, actorId, actorRole, text);
      set.status = 201;
      return createSuccessResponse('Pesan chat berhasil dikirim', data);
    } catch (e: any) {
      if (e.message.includes('Akses ditolak') || e.message.includes('Appointment tidak ditemukan') || e.message.includes('Pesan chat')) {
        set.status = 400;
        return createErrorResponse('Bad Request', e.message);
      }
      set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }
}
