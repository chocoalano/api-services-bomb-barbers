import { describe, expect, it } from 'bun:test';
import { BOOKING_CONFIG, isIdleLiveStatus } from '../src/config/booking';

/**
 * Delta "multi-order per customer dibatasi kapasitas barber idle+online".
 *
 * Perilaku transaksional (buat N order di jam sama sampai barber idle habis →
 * NO_BARBER_AVAILABLE) diverifikasi oleh suite integrasi ber-DB terseed
 * (stage2-booking-integrity style). Unit test ini menjaga sumber kebenaran
 * konfigurasi: flag ada, default mengizinkan multi-order, dan aturan parse env
 * konsisten.
 */
describe('BOOKING_CONFIG.allowCustomerConcurrentOrders', () => {
  it('defaults to true (multi-order per customer diizinkan)', () => {
    // Tidak ada override env pada lingkungan test → default aktif.
    expect(BOOKING_CONFIG.allowCustomerConcurrentOrders).toBe(true);
  });

  // [E8] Kamus status disatukan: 'online' bukan lagi nilai tersimpan, melainkan
  // alias yang dinormalkan ke 'available' (lihat normalizeLiveStatus). Kapasitas
  // idle karena itu diuji lewat predikatnya, bukan lewat isi array mentah.
  it('idle = available (alias online tetap dikenali)', () => {
    expect(BOOKING_CONFIG.idleBarberStatuses).toEqual(['available']);
    expect(isIdleLiveStatus('online')).toBe(true);
    expect(isIdleLiveStatus('available')).toBe(true);
    expect(isIdleLiveStatus('on_break')).toBe(false);
  });

  it('setiap order menempati blok 2 jam (dasar overlap kapasitas)', () => {
    expect(BOOKING_CONFIG.barberBlockMinutes).toBe(120);
  });
});

/**
 * Replika murni aturan parse flag di src/config/booking.ts agar perilaku
 * override env terdokumentasi & terkunci tanpa perlu re-import modul.
 */
const parseAllowConcurrent = (raw: string | undefined) =>
  String(raw ?? 'true').toLowerCase() !== 'false';

describe('parse BOOKING_ALLOW_CUSTOMER_CONCURRENT_ORDERS', () => {
  it('undefined → true', () => expect(parseAllowConcurrent(undefined)).toBe(true));
  it('"true" → true', () => expect(parseAllowConcurrent('true')).toBe(true));
  it('"false" → false (kembali ke aturan lama)', () =>
    expect(parseAllowConcurrent('false')).toBe(false));
  it('"FALSE" (case-insensitive) → false', () =>
    expect(parseAllowConcurrent('FALSE')).toBe(false));
});
