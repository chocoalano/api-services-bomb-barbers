import { describe, expect, it } from 'bun:test';
import {
  generateBarberOpenOrderSlots,
  generateCustomerBookingSlots,
  getOpenOrderPeriodForCustomerSlot,
  isValidBarberOpenOrderSlot,
  isValidCustomerBookingSlot
} from '../src/config/booking';
import { OpenOrderService, type OpenOrderContext } from '../src/core/appointments/open-order.service';

// ============================================================================
// Unit test murni (tanpa DB) untuk logika slot & Open Order sesuai spec §20.
// ============================================================================

describe('generateBarberOpenOrderSlots (spec §16, §20.1–2)', () => {
  const slots = generateBarberOpenOrderSlots('2026-07-11');

  it('hanya menghasilkan jam kelipatan 2 jam 08:00–22:00', () => {
    expect(slots).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00']);
  });

  it('menyertakan jam 22:00', () => {
    expect(slots).toContain('22:00');
  });

  it('tidak menghasilkan jam ganjil, 23:00, atau 24:00', () => {
    expect(slots).not.toContain('09:00');
    expect(slots).not.toContain('23:00');
    expect(slots).not.toContain('24:00');
  });
});

describe('generateCustomerBookingSlots (spec §16, §20.3–5)', () => {
  const slots = generateCustomerBookingSlots('2026-07-11');

  it('menghasilkan jam 08:00 sampai 22:00 per 1 jam', () => {
    expect(slots).toEqual([
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
      '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'
    ]);
  });

  it('menyertakan jam 22:00', () => {
    expect(slots).toContain('22:00');
  });

  it('tidak menghasilkan jam 23:00', () => {
    expect(slots).not.toContain('23:00');
    expect(slots.length).toBe(15);
  });
});

describe('isValidCustomerBookingSlot (R2: hanya jam-bulat; batas buka/tutup di jam operasional cabang)', () => {
  it('menerima setiap jam penuh (batas cabang bukan lagi tanggung jawab fungsi ini)', () => {
    // Sejak R2 (jam dinamis per-branch), fungsi ini HANYA memvalidasi jam bulat.
    // Batas buka/tutup ditegakkan `fitsOperatingWindow` per cabang, sehingga
    // cabang yang buka <08:00 atau tutup >22:00 tetap konsisten.
    for (const t of ['07:00', '08:00', '22:00', '23:00', '00:00']) {
      expect(isValidCustomerBookingSlot(t)).toBe(true);
    }
  });

  it('menolak jam bukan jam penuh (menit != 00)', () => {
    expect(isValidCustomerBookingSlot('08:30')).toBe(false);
    expect(isValidCustomerBookingSlot('22:30')).toBe(false);
    expect(isValidCustomerBookingSlot('07:30')).toBe(false);
  });
});

describe('isValidBarberOpenOrderSlot (spec §16)', () => {
  it('menerima slot kelipatan 2 jam', () => {
    for (const t of ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00']) {
      expect(isValidBarberOpenOrderSlot(t)).toBe(true);
    }
  });

  it('menolak jam ganjil & di luar rentang', () => {
    for (const t of ['09:00', '11:00', '21:00', '23:00', '07:00']) {
      expect(isValidBarberOpenOrderSlot(t)).toBe(false);
    }
  });
});

describe('getOpenOrderPeriodForCustomerSlot (spec §16, §20.20)', () => {
  it('memetakan jam booking customer ke periode Open Order 2 jam', () => {
    const expected: Record<string, string> = {
      '08:00': '08:00', '09:00': '08:00',
      '10:00': '10:00', '11:00': '10:00',
      '12:00': '12:00', '13:00': '12:00',
      '14:00': '14:00', '15:00': '14:00',
      '16:00': '16:00', '17:00': '16:00',
      '18:00': '18:00', '19:00': '18:00',
      '20:00': '20:00', '21:00': '20:00',
      '22:00': '22:00'
    };
    for (const [booking, period] of Object.entries(expected)) {
      expect(getOpenOrderPeriodForCustomerSlot(booking)).toBe(period);
    }
  });

  it('Open Order 22:00 hanya mencakup booking 22:00 (21:00 → periode 20:00)', () => {
    expect(getOpenOrderPeriodForCustomerSlot('22:00')).toBe('22:00');
    expect(getOpenOrderPeriodForCustomerSlot('21:00')).toBe('20:00');
  });

  it('mengembalikan null untuk slot tidak valid', () => {
    expect(getOpenOrderPeriodForCustomerSlot('07:00')).toBeNull();
    expect(getOpenOrderPeriodForCustomerSlot('08:30')).toBeNull();
    expect(getOpenOrderPeriodForCustomerSlot('23:00')).toBeNull();
  });
});

describe('OpenOrderService.isBarberOpen (gating murni, spec §10.3/§11.3)', () => {
  // grid default 08:00–22:00 (menit) — identik dengan konstanta config.
  const ctx = (openByBarber: Map<string, Set<string>>, tableAvailable = true): OpenOrderContext =>
    ({ tableAvailable, openByBarber, grid: { openMin: 8 * 60, closeMin: 22 * 60 } });

  it('barber yang membuka periode 08:00 tersedia untuk booking 08:00 & 09:00, bukan 10:00', () => {
    const context = ctx(new Map([['barberA', new Set(['08:00'])]]));
    expect(OpenOrderService.isBarberOpen(context, 'barberA', '08:00')).toBe(true);
    expect(OpenOrderService.isBarberOpen(context, 'barberA', '09:00')).toBe(true);
    expect(OpenOrderService.isBarberOpen(context, 'barberA', '10:00')).toBe(false);
  });

  it('Open Order 22:00 hanya mencakup booking 22:00', () => {
    const context = ctx(new Map([['barberA', new Set(['22:00'])]]));
    expect(OpenOrderService.isBarberOpen(context, 'barberA', '22:00')).toBe(true);
    expect(OpenOrderService.isBarberOpen(context, 'barberA', '21:00')).toBe(false);
  });

  it('backward-compatible: barber tanpa record Open Order dianggap open (default)', () => {
    const context = ctx(new Map());
    expect(OpenOrderService.isBarberOpen(context, 'barberX', '10:00')).toBe(true);
  });

  it('tabel belum ada → gating dinonaktifkan (selalu true untuk slot valid)', () => {
    const context = ctx(new Map(), false);
    expect(OpenOrderService.isBarberOpen(context, 'barberX', '10:00')).toBe(true);
  });

  it('slot tidak valid selalu false', () => {
    const context = ctx(new Map([['barberA', new Set(['08:00'])]]));
    expect(OpenOrderService.isBarberOpen(context, 'barberA', '08:30')).toBe(false);
    expect(OpenOrderService.isBarberOpen(context, 'barberA', '23:00')).toBe(false);
  });
});
