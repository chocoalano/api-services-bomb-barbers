import { describe, expect, it } from 'bun:test';
import {
  blockOf,
  computeScheduleBlock,
  evaluateBarber,
  evaluateSlotTiming,
  fitsOperatingWindow,
  lastBookableStartMinutes,
  rangesOverlap,
  resolveOperatingWindow,
  type BarberSnapshot
} from '../src/core/booking/rules';
import { BOOKING_CONFIG, normalizeLiveStatus, isIdleLiveStatus } from '../src/config/booking';

/**
 * Unit tes evaluator aturan booking (E1–E11). Murni tanpa DB: `rules/` menerima
 * snapshot, bukan koneksi — lihat
 * plans/audit/revisi/e1_e8_satu_sumber_aturan_slot_2026-07-21.md §4.2.
 */

const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
const DATE = '2026-08-10';

const window0822 = resolveOperatingWindow({ open_time: '08:00:00', close_time: '22:00:00' })!;

describe('E4 — jam operasional cabang', () => {
  it('baris yang hilang menghasilkan window null (fail-closed)', () => {
    expect(resolveOperatingWindow(null)).toBeNull();
    expect(resolveOperatingWindow(undefined)).toBeNull();
    expect(resolveOperatingWindow({ open_time: null, close_time: '22:00' })).toBeNull();
  });

  it('jam tutup <= jam buka ditolak, bukan diam-diam dipakai', () => {
    expect(resolveOperatingWindow({ open_time: '22:00', close_time: '08:00' })).toBeNull();
  });

  it('window null membuat setiap jadwal ditolak BRANCH_HOURS_MISSING', () => {
    const verdict = fitsOperatingWindow(at(DATE, '10:00'), 60, null);
    expect(verdict.ok).toBe(false);
    expect((verdict as any).code).toBe('BRANCH_HOURS_MISSING');
  });
});

describe('E1 — layanan wajib selesai sebelum jam tutup', () => {
  it('jam mulai terakhir mengikuti durasi layanan', () => {
    expect(lastBookableStartMinutes(window0822, 30)).toBe(21 * 60 + 30);
    expect(lastBookableStartMinutes(window0822, 60)).toBe(21 * 60);
    expect(lastBookableStartMinutes(window0822, 90)).toBe(20 * 60 + 30);
    expect(lastBookableStartMinutes(window0822, 120)).toBe(20 * 60);
  });

  it('slot 22:00 dengan layanan 60 menit DITOLAK (dulu ditawarkan lalu gagal)', () => {
    const verdict = fitsOperatingWindow(at(DATE, '22:00'), 60, window0822);
    expect(verdict.ok).toBe(false);
    expect((verdict as any).code).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('slot 21:00 dengan layanan 60 menit diterima (selesai tepat 22:00)', () => {
    expect(fitsOperatingWindow(at(DATE, '21:00'), 60, window0822).ok).toBe(true);
  });

  it('layanan 90 menit kehilangan slot 21:00 tapi tetap punya 20:00', () => {
    expect(fitsOperatingWindow(at(DATE, '21:00'), 90, window0822).ok).toBe(false);
    expect(fitsOperatingWindow(at(DATE, '20:00'), 90, window0822).ok).toBe(true);
  });

  it('sebelum jam buka tetap ditolak', () => {
    expect(fitsOperatingWindow(at(DATE, '07:00'), 60, window0822).ok).toBe(false);
  });

  it('cabang yang tutup lebih malam memperbolehkan slot lebih malam', () => {
    const until23 = resolveOperatingWindow({ open_time: '08:00', close_time: '23:00' })!;
    expect(fitsOperatingWindow(at(DATE, '22:00'), 60, until23).ok).toBe(true);
  });
});

describe('D2 — cap statis 22:00 dihapus (semua mengikuti close_time cabang)', () => {
  it('jam mulai terakhir murni close_time − durasi, boleh melewati 22:00', () => {
    // Cabang tutup 23:00, layanan 30 menit → slot mulai terakhir 22:30.
    // Dengan cap lama (min 22:00) hasilnya keliru terpotong ke 22:00.
    const until23 = resolveOperatingWindow({ open_time: '08:00', close_time: '23:00' })!;
    expect(lastBookableStartMinutes(until23, 30)).toBe(22 * 60 + 30);
    expect(fitsOperatingWindow(at(DATE, '22:00'), 60, until23).ok).toBe(true);
  });

  it('cabang boleh buka sebelum 08:00 (mis. 07:00)', () => {
    const from07 = resolveOperatingWindow({ open_time: '07:00', close_time: '22:00' })!;
    expect(fitsOperatingWindow(at(DATE, '07:00'), 60, from07).ok).toBe(true);
    expect(fitsOperatingWindow(at(DATE, '06:00'), 60, from07).ok).toBe(false);
  });
});

describe('D1 — hari libur (is_closed)', () => {
  it('is_closed=true → window ditandai libur, ditolak BRANCH_CLOSED_ON_DAY', () => {
    const closed = resolveOperatingWindow({ is_closed: true, open_time: '08:00', close_time: '22:00' })!;
    expect(closed.isClosed).toBe(true);
    const verdict = fitsOperatingWindow(at(DATE, '10:00'), 60, closed);
    expect(verdict.ok).toBe(false);
    expect((verdict as any).code).toBe('BRANCH_CLOSED_ON_DAY');
  });

  it('dibedakan dari baris hilang (BRANCH_HOURS_MISSING)', () => {
    const missing = fitsOperatingWindow(at(DATE, '10:00'), 60, resolveOperatingWindow(null));
    expect((missing as any).code).toBe('BRANCH_HOURS_MISSING');
  });
});

describe('E5/E11 — blok okupansi barber', () => {
  it('layanan pendek tetap mengunci 2 jam penuh', () => {
    const block = computeScheduleBlock({ startAt: at(DATE, '09:00'), durationMin: 30 });
    expect(block.start.toISOString()).toBe(at(DATE, '09:00').toISOString());
    expect(block.end.toISOString()).toBe(at(DATE, '11:00').toISOString());
  });

  it('layanan gabungan >2 jam mengunci sepanjang durasinya (E11)', () => {
    const block = computeScheduleBlock({ startAt: at(DATE, '09:00'), durationMin: 150 });
    expect(block.end.toISOString()).toBe(at(DATE, '11:30').toISOString());
  });

  it('buffer home_service mengembang ke kedua sisi', () => {
    const block = computeScheduleBlock({
      startAt: at(DATE, '09:00'),
      durationMin: 30,
      travelBufferMin: 15
    });
    expect(block.start.toISOString()).toBe(at(DATE, '08:45').toISOString());
    // 08:45 + 2 jam = 10:45 (lantai 2 jam masih menang atas 09:45)
    expect(block.end.toISOString()).toBe(at(DATE, '10:45').toISOString());
  });

  it('E10 — order lama tanpa schedule_block tetap memblok 2 jam', () => {
    const block = blockOf({
      scheduled_at: at(DATE, '14:00').toISOString(),
      scheduled_end_at: at(DATE, '14:30').toISOString(),
      schedule_block_start_at: null,
      schedule_block_end_at: null
    });
    expect(block).not.toBeNull();
    expect(block!.end.toISOString()).toBe(at(DATE, '16:00').toISOString());
  });

  it('dua order 30 menit berjarak 45 menit saling bertabrakan', () => {
    const first = computeScheduleBlock({ startAt: at(DATE, '09:00'), durationMin: 30 });
    const second = computeScheduleBlock({ startAt: at(DATE, '09:45'), durationMin: 30 });
    expect(rangesOverlap(first, second)).toBe(true);
  });
});

describe('E8 — kamus status barber', () => {
  it('istilah app barber dipetakan ke kamus admin', () => {
    expect(normalizeLiveStatus('online')).toBe('available');
    expect(normalizeLiveStatus('unavailable')).toBe('on_break');
    expect(normalizeLiveStatus('ON_BREAK')).toBe('on_break');
  });

  it('nilai tak dikenal & kosong jatuh ke offline (fail-closed)', () => {
    expect(normalizeLiveStatus(null)).toBe('offline');
    expect(normalizeLiveStatus('entah')).toBe('offline');
  });

  it('hanya available yang dianggap siap menerima order', () => {
    expect(isIdleLiveStatus('online')).toBe(true);
    expect(isIdleLiveStatus('available')).toBe(true);
    expect(isIdleLiveStatus('serving')).toBe(false);
    expect(isIdleLiveStatus('on_break')).toBe(false);
    expect(isIdleLiveStatus('unavailable')).toBe(false);
  });
});

describe('evaluateBarber — satu predikat untuk semua lapisan', () => {
  const barber: BarberSnapshot = {
    id: 'b1',
    live_status: 'available',
    approval_status: 'approved',
    staff_active: true
  };
  const requestedBlock = computeScheduleBlock({ startAt: at(DATE, '10:00'), durationMin: 60 });
  const base = {
    barber,
    requestedBlock,
    dayOrderCount: 0,
    existingBlocks: [],
    timeOff: [],
    isOpenOrder: true
  };

  it('barber bebas diterima', () => {
    expect(evaluateBarber(base).ok).toBe(true);
  });

  it('E3 — staff nonaktif ditolak', () => {
    const verdict = evaluateBarber({ ...base, barber: { ...barber, staff_active: false } });
    expect(verdict.ok).toBe(false);
    expect((verdict as any).code).toBe('BARBER_INACTIVE');
  });

  it('barber yang belum disetujui admin ditolak', () => {
    const verdict = evaluateBarber({
      ...base,
      barber: { ...barber, approval_status: 'pending' }
    });
    expect(verdict.ok).toBe(false);
  });

  it('E2 — barber cuti ditolak (dulu justru jadi kandidat teratas auto-pick)', () => {
    const verdict = evaluateBarber({
      ...base,
      timeOff: [{ start: at(DATE, '00:00'), end: at(DATE, '23:00') }]
    });
    expect(verdict.ok).toBe(false);
    expect((verdict as any).code).toBe('BARBER_ON_LEAVE');
  });

  it('E7 — kuota harian penuh ditolak dengan kode yang sama di semua lapisan', () => {
    const verdict = evaluateBarber({
      ...base,
      dayOrderCount: BOOKING_CONFIG.maxDailyOrdersPerBarber
    });
    expect(verdict.ok).toBe(false);
    expect((verdict as any).code).toBe('BARBER_QUOTA_FULL');
  });

  it('E5 — bentrok blok 2 jam ditolak walau layanannya pendek', () => {
    const verdict = evaluateBarber({
      ...base,
      existingBlocks: [computeScheduleBlock({ startAt: at(DATE, '09:00'), durationMin: 30 })]
    });
    expect(verdict.ok).toBe(false);
  });

  it('barber yang sedang melayani (serving) tidak ditawarkan', () => {
    expect(evaluateBarber({ ...base, barber: { ...barber, live_status: 'serving' } }).ok).toBe(false);
  });

  it('barber di luar radius home_service ditolak', () => {
    expect(evaluateBarber({ ...base, withinRadius: false }).ok).toBe(false);
  });

  it('barber yang tidak membuka Open Order ditolak', () => {
    const verdict = evaluateBarber({ ...base, isOpenOrder: false });
    expect((verdict as any).code).toBe('BARBER_NOT_OPEN');
  });
});

describe('evaluateSlotTiming — jam, slot, dan jeda minimal', () => {
  const now = at(DATE, '08:00');

  it('slot bukan kelipatan 1 jam ditolak saat jadwal eksplisit', () => {
    const verdict = evaluateSlotTiming({
      startAt: at(DATE, '10:30'),
      durationMin: 60,
      window: window0822,
      now,
      enforceMinLead: false
    });
    expect((verdict as any).code).toBe('INVALID_SLOT');
  });

  it('order on-demand tidak dipaksa jatuh di jam bulat', () => {
    expect(
      evaluateSlotTiming({
        startAt: at(DATE, '10:30'),
        durationMin: 60,
        window: window0822,
        now,
        enforceSlot: false,
        enforceMinLead: false
      }).ok
    ).toBe(true);
  });

  it('jeda minimal 6 jam ditegakkan dengan kode TOO_SOON', () => {
    const verdict = evaluateSlotTiming({
      startAt: at(DATE, '10:00'),
      durationMin: 60,
      window: window0822,
      now
    });
    expect((verdict as any).code).toBe('TOO_SOON');
  });

  it('slot setelah jeda minimal diterima', () => {
    expect(
      evaluateSlotTiming({
        startAt: at(DATE, '15:00'),
        durationMin: 60,
        window: window0822,
        now
      }).ok
    ).toBe(true);
  });
});
