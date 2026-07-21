import { describe, expect, it } from 'bun:test';
import {
  BOOKING_CONFIG,
  earliestBookableAt,
  satisfiesMinLead
} from '../src/config/booking';

/**
 * Aturan "pemesanan minimal 6 jam sebelum jadwal".
 *
 * Customer yang membuka aplikasi pukul 08:00 hanya boleh memilih 14:00 ke atas.
 * Batas bersifat INKLUSIF pada instant now+6 jam, dan ketat terhadap menit:
 * pukul 08:07 batasnya 14:07 sehingga slot jam-bulat pertama adalah 15:00.
 *
 * Penerapannya pada daftar slot (modules/customers/availability) dan pada
 * pembuatan/perubahan order (core/appointments) diverifikasi suite integrasi
 * ber-DB; unit test ini mengunci helper murni yang jadi sumber kebenarannya.
 */

/** Instant pada tanggal tetap & jam lokal Asia/Jakarta. */
const wib = (hour: number, minute = 0) =>
  new Date(`2026-07-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`);

describe('BOOKING_CONFIG.minCustomerLeadMinutes', () => {
  it('default 6 jam', () => {
    expect(BOOKING_CONFIG.minCustomerLeadMinutes).toBe(360);
  });
});

describe('earliestBookableAt', () => {
  it('08:00 → batas terawal 14:00', () => {
    expect(earliestBookableAt(wib(8)).toISOString()).toBe(wib(14).toISOString());
  });

  it('menit ikut dihitung: 08:07 → 14:07', () => {
    expect(earliestBookableAt(wib(8, 7)).toISOString()).toBe(wib(14, 7).toISOString());
  });
});

describe('satisfiesMinLead', () => {
  const now = wib(8);

  it('tepat now+6 jam diterima (inklusif)', () => {
    expect(satisfiesMinLead(wib(14), now)).toBe(true);
  });

  it('satu menit sebelum batas ditolak', () => {
    expect(satisfiesMinLead(wib(13, 59), now)).toBe(false);
  });

  it('jam yang sudah lewat ditolak', () => {
    expect(satisfiesMinLead(wib(7), now)).toBe(false);
  });

  it('skenario klien: buka aplikasi 08:00 → 14:00 s/d 22:00 terbuka, 09:00–13:00 tertutup', () => {
    const open: number[] = [];
    const closed: number[] = [];
    for (let hour = 8; hour <= 22; hour += 1) {
      (satisfiesMinLead(wib(hour), now) ? open : closed).push(hour);
    }
    expect(open).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(closed).toEqual([8, 9, 10, 11, 12, 13]);
  });

  it('buka aplikasi 08:07 → slot jam-bulat pertama 15:00 (aturan ketat)', () => {
    expect(satisfiesMinLead(wib(14), wib(8, 7))).toBe(false);
    expect(satisfiesMinLead(wib(15), wib(8, 7))).toBe(true);
  });

  it('setelah 16:00 tidak ada satupun slot tersisa pada hari yang sama', () => {
    const now17 = wib(17);
    const anyOpen = Array.from({ length: 15 }, (_, i) => i + 8)
      .some((hour) => satisfiesMinLead(wib(hour), now17));
    expect(anyOpen).toBe(false);
  });
});
