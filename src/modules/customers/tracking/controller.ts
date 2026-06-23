import { TrackingService } from './service';
import { createSuccessResponse, createErrorResponse } from '../../../shared/response';

const service = new TrackingService();

const isTrackingClientError = (message: string) => [
  'consent',
  'tidak aktif',
  'kedaluwarsa',
  'akses',
  'Akses',
  'ditemukan',
  'hanya dapat',
  'harus',
  'wajib',
  'tidak valid',
  'terlalu lama',
  'masa depan',
  'Terlalu banyak',
  'sudah pernah',
  'manual hanya',
  'ditolak',
  'terlalu rendah'
].some((fragment) => message.includes(fragment));

export class TrackingController {
  static async startTracking(ctx: any) {
    try {
      const appointmentId = ctx.params.id;
      const customerId = ctx.customerId;
      const { consent } = ctx.body;

      const data = await service.startTracking(appointmentId, customerId, consent);
      ctx.set.status = 201;
      return createSuccessResponse('Tracking session dimulai', data);
    } catch (e: any) {
      if (isTrackingClientError(e.message)) {
        ctx.set.status = 400;
        return createErrorResponse('Bad Request', e.message);
      }
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async updateETA(ctx: any) {
    try {
      const appointmentId = ctx.params.id;
      const customerId = ctx.customerId;

      const data = await service.updateETA(appointmentId, customerId, ctx.body);
      return createSuccessResponse('Lokasi customer berhasil diperbarui', data);
    } catch (e: any) {
      if (isTrackingClientError(e.message)) {
        ctx.set.status = 400;
        return createErrorResponse('Bad Request', e.message);
      }
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async getETA(ctx: any) {
    try {
      const appointmentId = ctx.params.id;
      const customerId = ctx.customerId;

      const data = await service.getETA(appointmentId, customerId);
      return createSuccessResponse('ETA tracking berhasil diambil', data);
    } catch (e: any) {
      if (e.message.includes('ditemukan') || e.message.includes('Akses')) {
        ctx.set.status = 404;
        return createErrorResponse('Not Found', e.message);
      }
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async checkIn(ctx: any) {
    try {
      const appointmentId = ctx.params.id;
      const customerId = ctx.customerId;

      const data = await service.checkIn(appointmentId, customerId, ctx.body);
      ctx.set.status = 201;
      return createSuccessResponse('Check-in berhasil', data);
    } catch (e: any) {
      if (isTrackingClientError(e.message)) {
        ctx.set.status = 400;
        return createErrorResponse('Bad Request', e.message);
      }
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }

  static async revokeTracking(ctx: any) {
    try {
      const appointmentId = ctx.params.id;
      const customerId = ctx.customerId;

      const data = await service.revokeTracking(appointmentId, customerId);
      return createSuccessResponse('Tracking session berhasil dicabut', data);
    } catch (e: any) {
      if (isTrackingClientError(e.message)) {
        ctx.set.status = 400;
        return createErrorResponse('Bad Request', e.message);
      }
      ctx.set.status = 500;
      return createErrorResponse('Internal Server Error', e.message);
    }
  }
}
