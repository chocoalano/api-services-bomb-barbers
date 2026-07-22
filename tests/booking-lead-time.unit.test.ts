import { describe, expect, it } from 'bun:test';
import {
  BOOKING_CONFIG,
  earliestBookableAt,
  earliestBookableForSlot,
  jakartaDayOffset,
  minLeadAppliesTo,
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

// ============================================================================
// DAY-SCOPED: jeda hanya berlaku H+0/H+1, lusa ke atas bebas (klien 2026-07-22)
// ============================================================================

/** Instant pada tanggal & jam lokal Asia/Jakarta (tanggal eksplisit). */
const wibOn = (day: number, hour: number, minute = 0) =>
  new Date(
    `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`
  );

describe('jakartaDayOffset', () => {
  const now = wibOn(22, 8);
  it('hari ini → 0', () => expect(jakartaDayOffset(wibOn(22, 20), now)).toBe(0));
  it('besok → 1', () => expect(jakartaDayOffset(wibOn(23, 8), now)).toBe(1));
  it('lusa → 2', () => expect(jakartaDayOffset(wibOn(24, 8), now)).toBe(2));
  it('lintas tengah malam: now 22 pukul 22:00, slot 23 pukul 08:00 → 1', () => {
    expect(jakartaDayOffset(wibOn(23, 8), wibOn(22, 22))).toBe(1);
  });
});

describe('minLeadAppliesTo (default maxDayOffset = 1)', () => {
  const now = wibOn(22, 8);
  it('hari ini (H+0) → berlaku', () => expect(minLeadAppliesTo(wibOn(22, 10), now)).toBe(true));
  it('besok (H+1) → berlaku', () => expect(minLeadAppliesTo(wibOn(23, 8), now)).toBe(true));
  it('lusa (H+2) → TIDAK berlaku', () => expect(minLeadAppliesTo(wibOn(24, 8), now)).toBe(false));
  it('seterusnya (H+3) → TIDAK berlaku', () => expect(minLeadAppliesTo(wibOn(25, 8), now)).toBe(false));
});

describe('earliestBookableForSlot', () => {
  const now = wibOn(22, 8);
  it('H+0 → now + jeda (14:00)', () => {
    expect(earliestBookableForSlot(wibOn(22, 8), now)?.toISOString()).toBe(wibOn(22, 14).toISOString());
  });
  it('H+1 → now + jeda', () => {
    expect(earliestBookableForSlot(wibOn(23, 8), now)?.toISOString()).toBe(wibOn(22, 14).toISOString());
  });
  it('H+2 (lusa) → null (jeda tidak berlaku)', () => {
    expect(earliestBookableForSlot(wibOn(24, 8), now)).toBeNull();
  });
});

describe('satisfiesMinLead — day-scoped (skenario klien)', () => {
  it('order 22 pukul 22:00 untuk 23 pukul 08:00 → 6 jam masih aktif & lolos (selisih 10 jam)', () => {
    expect(satisfiesMinLead(wibOn(23, 8), wibOn(22, 22))).toBe(true);
  });

  it('lusa (H+2) bebas: seluruh 08:00–22:00 terbuka apa pun jam order', () => {
    const now = wibOn(22, 20); // sore, jeda would still be irrelevant
    const allOpen = Array.from({ length: 15 }, (_, i) => i + 8)
      .every((hour) => satisfiesMinLead(wibOn(24, hour), now));
    expect(allOpen).toBe(true);
  });

  it('lusa dini hari sekalipun lolos (jeda dinonaktifkan, bukan sekadar kebetulan jarak)', () => {
    // Slot 24 pukul 08:00 dipesan 24 pukul 07:00 (selisih 1 jam) tetapi offset dari
    // "sekarang" (22) = 2 → jeda tidak berlaku → lolos.
    expect(satisfiesMinLead(wibOn(24, 8), wibOn(22, 7))).toBe(true);
  });
});
