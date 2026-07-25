// ============================================================================
// [E8] STATUS KEHADIRAN BARBER — SATU PINTU TULIS
// ----------------------------------------------------------------------------
// Dulu status ditulis di tiga tempat dengan kamus berbeda dan tujuan berbeda:
//   - barber.controller.ts  → DB + Redis, kamus online|offline|unavailable
//   - admin/barbers/service → DB saja,    kamus available|serving|on_break|offline
//   - lifecycle.service.ts  → Redis saja, nilai serving|available
// Karena booking membaca DB, status yang hanya masuk Redis tidak pernah
// berpengaruh: barber yang sedang melayani tetap ditawarkan ke customer.
//
// Keputusan klien 2026-07-21: DB sumber kebenaran, Redis cache. Semua penulisan
// WAJIB lewat `setBarberLiveStatus` agar keduanya tidak pernah berbeda lagi.
// ============================================================================

import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { barbers } from '../../db/schema';
import { redis, getBarberStatusKey } from '../../lib/redis';
import { logger } from '../../lib/logger';
import { normalizeLiveStatus, type BarberLiveStatus } from '../../config/booking';
import { emitBarberStatusChanged } from '../../lib/socket';

/**
 * Saklar fitur presence realtime. Bila mati, status barber tetap tersimpan ke
 * DB/Redis seperti biasa tetapi tidak dipancarkan lewat socket.
 *
 * Default: HIDUP (opt-out lewat REALTIME_BARBER_PRESENCE=false). Dulu default-nya
 * mati sehingga server produksi — yang env-nya tidak pernah menyetel variabel ini
 * — tidak pernah memancarkan `barber:status_changed`: badge kehadiran barber di
 * form Buat Pesanan diam sampai customer memuat ulang cabang. Emisi ini
 * non-kritis dan payload-nya non-sensitif, jadi menyala secara default adalah
 * perilaku yang benar.
 */
const isRealtimePresenceEnabled = () =>
  String(process.env.REALTIME_BARBER_PRESENCE ?? 'true').toLowerCase() !== 'false';

/**
 * Tulis status kehadiran barber ke DB (otoritas) lalu ke Redis (cache).
 * Nilai apa pun dinormalkan dulu ke kamus kanonik, jadi pemanggil boleh
 * mengirim istilah lama ('online'/'unavailable') tanpa merusak konsistensi.
 *
 * Kegagalan Redis TIDAK menggagalkan operasi: DB sudah benar dan pembaca punya
 * fallback ke DB. Kegagalan DB dilempar — itu kehilangan data yang sebenarnya.
 */
export const setBarberLiveStatus = async (
  barberId: string,
  status: string
): Promise<BarberLiveStatus> => {
  const canonical = normalizeLiveStatus(status);

  await db.update(barbers).set({ liveStatus: canonical }).where(eq(barbers.id, barberId));

  try {
    await redis.set(getBarberStatusKey(barberId), canonical);
  } catch (err: any) {
    logger.error({ err, barberId, status: canonical }, '[Presence] Gagal menulis cache status barber');
  }

  // [Realtime presence] Pancarkan perubahan status ke customer yang sedang
  // melihat daftar barber cabang ini (room `branch:presence:<branchId>`).
  // Non-kritis: kegagalan emit / lookup TIDAK menggagalkan operasi — DB sudah
  // benar dan pembaca punya fallback (fetch ulang / polling).
  if (isRealtimePresenceEnabled()) {
    try {
      const [row] = await db
        .select({ branchId: barbers.branchId })
        .from(barbers)
        .where(eq(barbers.id, barberId))
        .limit(1);
      if (row?.branchId) {
        emitBarberStatusChanged({
          barber_id: barberId,
          branch_id: row.branchId,
          live_status: canonical,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err: any) {
      logger.error({ err, barberId, status: canonical }, '[Presence] Gagal emit status barber realtime');
    }
  }

  return canonical;
};
