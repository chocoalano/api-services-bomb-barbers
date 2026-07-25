import { describe, expect, it } from 'bun:test';
import {
  buildStepKeys,
  resolveOrderStage,
  resolveStageKey,
  type StageInput
} from '../src/core/appointments/stage';

/**
 * Matriks tahapan pesanan — sumber kebenaran stepper di SELURUH aplikasi.
 *
 * Suite ini mengunci kombinasi (fulfillment × status × journey × payment) yang
 * dulu salah dibaca aplikasi customer: perjalanan barber tidak terlihat, order
 * batal tampil seolah baru dibuat, dan fase pembayaran tidak punya langkah.
 * Setiap status baru WAJIB menambah kasus di sini — kalau tidak, ia akan diam-
 * diam jatuh ke tahap "menunggu".
 */

const order = (overrides: Partial<StageInput> = {}): StageInput => ({
  status: 'pending',
  journey_status: 'not_started',
  payment_status: 'unpaid',
  fulfillment_type: 'in_store',
  source: 'online_booking',
  ...overrides
});

describe('buildStepKeys', () => {
  it('in-store online: Bayar → Dikonfirmasi → Antrean → Dilayani → Selesai', () => {
    expect(buildStepKeys(order())).toEqual([
      'payment',
      'confirmed',
      'queue',
      'service',
      'done'
    ]);
  });

  it('home service menambahkan langkah perjalanan barber', () => {
    expect(buildStepKeys(order({ fulfillment_type: 'home_service' }))).toEqual([
      'payment',
      'confirmed',
      'en_route',
      'arrived',
      'service',
      'done'
    ]);
  });

  it('walk-in tidak punya langkah Bayar (dibayar tunai di lokasi)', () => {
    expect(buildStepKeys(order({ source: 'walk_in' }))).toEqual([
      'confirmed',
      'queue',
      'service',
      'done'
    ]);
  });
});

describe('resolveStageKey', () => {
  it('pending + belum lunas → menunggu pembayaran', () => {
    expect(resolveStageKey(order())).toBe('awaiting_payment');
  });

  it('pending + lunas → menunggu barber menerima', () => {
    expect(resolveStageKey(order({ payment_status: 'paid' }))).toBe(
      'awaiting_acceptance'
    );
  });

  it('walk-in pending tidak pernah dianggap menunggu pembayaran', () => {
    expect(resolveStageKey(order({ source: 'walk_in' }))).toBe(
      'awaiting_acceptance'
    );
  });

  it('confirmed + journey en_route (home service) → barber di perjalanan', () => {
    expect(
      resolveStageKey(
        order({
          status: 'confirmed',
          journey_status: 'en_route',
          payment_status: 'paid',
          fulfillment_type: 'home_service'
        })
      )
    ).toBe('en_route');
  });

  it('confirmed tanpa keberangkatan tetap "accepted"', () => {
    expect(
      resolveStageKey(
        order({
          status: 'confirmed',
          payment_status: 'paid',
          fulfillment_type: 'home_service'
        })
      )
    ).toBe('accepted');
  });

  it('in_queue dibaca berbeda per jenis layanan', () => {
    expect(
      resolveStageKey(order({ status: 'in_queue', payment_status: 'paid' }))
    ).toBe('in_queue');
    expect(
      resolveStageKey(
        order({
          status: 'in_queue',
          payment_status: 'paid',
          fulfillment_type: 'home_service'
        })
      )
    ).toBe('arrived');
  });

  it('status terminal tidak pernah jatuh ke "menunggu"', () => {
    for (const [status, expected] of [
      ['cancelled', 'cancelled'],
      ['no_show', 'no_show'],
      ['completed', 'completed']
    ] as const) {
      expect(resolveStageKey(order({ status }))).toBe(expected);
    }
  });
});

describe('resolveOrderStage — indeks langkah', () => {
  it('menunggu pembayaran: belum ada langkah yang tercapai', () => {
    expect(resolveOrderStage(order()).index).toBe(-1);
  });

  it('lunas menyalakan langkah Bayar', () => {
    const stage = resolveOrderStage(order({ payment_status: 'paid' }));
    expect(stage.index).toBe(0);
    expect(stage.steps[0].key).toBe('payment');
  });

  it('en_route menyalakan langkah "Menuju Lokasi", bukan berhenti di Dikonfirmasi', () => {
    const stage = resolveOrderStage(
      order({
        status: 'confirmed',
        journey_status: 'en_route',
        payment_status: 'paid',
        fulfillment_type: 'home_service'
      })
    );
    expect(stage.steps[stage.index].key).toBe('en_route');
  });

  it('selesai menyalakan seluruh langkah', () => {
    const stage = resolveOrderStage(
      order({ status: 'completed', payment_status: 'paid' })
    );
    expect(stage.index).toBe(stage.steps.length - 1);
    expect(stage.terminal).toBe(true);
    expect(stage.failed).toBe(false);
  });

  it('check-in customer menampilkan setengah langkah menuju Antrean', () => {
    const stage = resolveOrderStage(
      order({
        status: 'confirmed',
        payment_status: 'paid',
        checked_in_at: '2026-07-25 03:00:00.000000'
      })
    );
    expect(stage.progress).toBe(0.5);
    expect(stage.steps[stage.index].key).toBe('confirmed');
  });

  it('home service tidak memakai kemajuan check-in', () => {
    const stage = resolveOrderStage(
      order({
        status: 'confirmed',
        payment_status: 'paid',
        fulfillment_type: 'home_service',
        checked_in_at: '2026-07-25 03:00:00.000000'
      })
    );
    expect(stage.progress).toBe(0);
  });
});

describe('resolveOrderStage — pesanan yang gagal', () => {
  it('batal sebelum dibayar: tidak ada langkah tercapai, langkah Bayar ditandai gagal', () => {
    const stage = resolveOrderStage(order({ status: 'cancelled' }));
    expect(stage.failed).toBe(true);
    expect(stage.index).toBe(-1);
    expect(stage.failed_index).toBe(0);
  });

  it('batal saat sedang dilayani tetap menunjukkan sejauh mana pesanan berjalan', () => {
    const stage = resolveOrderStage(
      order({
        status: 'cancelled',
        payment_status: 'paid',
        started_at: '2026-07-25 04:00:00.000000',
        checked_in_at: '2026-07-25 03:00:00.000000'
      })
    );
    expect(stage.steps[stage.index].key).toBe('service');
    expect(stage.failed_index).toBe(stage.index + 1);
  });

  it('no_show setelah dikonfirmasi berhenti di langkah Dikonfirmasi', () => {
    const stage = resolveOrderStage(
      order({
        status: 'no_show',
        payment_status: 'paid',
        status_timestamps: { confirmed: '2026-07-25 02:00:00.000000' }
      })
    );
    expect(stage.steps[stage.index].key).toBe('confirmed');
    expect(stage.failed).toBe(true);
  });
});

describe('resolveOrderStage — waktu tiap langkah', () => {
  it('hanya langkah yang sudah tercapai membawa jam', () => {
    const stage = resolveOrderStage(
      order({
        status: 'in_service',
        payment_status: 'paid',
        paid_at: '2026-07-25 01:00:00.000000',
        checked_in_at: '2026-07-25 03:00:00.000000',
        started_at: '2026-07-25 04:00:00.000000',
        status_timestamps: { confirmed: '2026-07-25 02:00:00.000000' }
      })
    );
    const byKey = Object.fromEntries(stage.steps.map((s) => [s.key, s.done_at]));
    expect(byKey.payment).toBe('2026-07-25 01:00:00.000000');
    expect(byKey.confirmed).toBe('2026-07-25 02:00:00.000000');
    expect(byKey.queue).toBe('2026-07-25 03:00:00.000000');
    expect(byKey.service).toBe('2026-07-25 04:00:00.000000');
    expect(byKey.done).toBeNull();
  });
});
