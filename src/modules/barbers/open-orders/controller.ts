import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { db } from '../../../lib/db';
import { snakeKeys, first } from '../../../db/helpers';
import { barbers } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { OpenOrderService } from '../../../core/appointments/open-order.service';
import { jakartaParts } from '../../../config/booking';

async function resolveBarber(staffId: string) {
  const rows = await db
    .select({ id: barbers.id, branchId: barbers.branchId })
    .from(barbers)
    .where(eq(barbers.staffUserId, staffId))
    .limit(1);
  return first(snakeKeys(rows)) as { id: string; branch_id: string } | null;
}

const todayJakarta = () => jakartaParts(new Date()).date;

export class BarberOpenOrderController {
  /** GET /barbers/open-orders?date=YYYY-MM-DD — daftar Open Order barber + opsi slot. */
  static async list({ staffId, query, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Profil barber tidak ditemukan'); }

      const date = (query?.date || todayJakarta()).trim();
      const openOrders = await OpenOrderService.listForBarber(barber.id, date);

      return createSuccessResponse('Daftar Open Order berhasil diambil', {
        date,
        available_slots: OpenOrderService.availableSlotOptions(date),
        open_orders: openOrders
      });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  /** POST /barbers/open-orders — buka satu/lebih periode Open Order (kelipatan 2 jam). */
  static async open({ staffId, body, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Profil barber tidak ditemukan'); }

      const date = (body?.order_date || todayJakarta()).trim();
      const startTimes: string[] = Array.isArray(body?.start_times)
        ? body.start_times
        : body?.start_time
          ? [body.start_time]
          : [];

      const openOrders = await OpenOrderService.openSlots(barber.id, barber.branch_id, date, startTimes);
      set.status = 201;
      return createSuccessResponse('Open Order berhasil dibuka', { date, open_orders: openOrders });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }

  /** POST /barbers/open-orders/close — tutup satu periode Open Order. */
  static async close({ staffId, body, set }: any) {
    try {
      const barber = await resolveBarber(staffId);
      if (!barber) { set.status = 403; return createErrorResponse('Profil barber tidak ditemukan'); }

      const date = (body?.order_date || todayJakarta()).trim();
      const startTime = (body?.start_time || '').trim();
      if (!startTime) { set.status = 400; return createErrorResponse('start_time wajib diisi'); }

      const openOrders = await OpenOrderService.closeSlot(barber.id, date, startTime);
      return createSuccessResponse('Open Order berhasil ditutup', { date, open_orders: openOrders });
    } catch (err: any) {
      set.status = err.status || 400;
      return createErrorResponse(err.message);
    }
  }
}
