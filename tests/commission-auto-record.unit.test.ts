import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Komisi barber harus tercatat OTOMATIS.
 *
 * Sebelumnya `calculateCommission` hanya punya satu pemanggil: route admin
 * manual. Akibatnya `commission_entries` tidak pernah terisi, saldo barber
 * selamanya Rp 0, dan tidak ada satu pun yang menyadarinya.
 *
 * Perilaku transaksionalnya (idempotensi via unique constraint, kredit dompet)
 * diverifikasi suite integrasi ber-DB. Unit test ini menjaga agar PEMICUNYA
 * tidak lepas lagi — bagian yang dulu hilang.
 */

const src = (relative: string) =>
  readFileSync(join(import.meta.dir, '..', 'src', relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('pemicu pencatatan komisi', () => {
  it('order yang bertransisi ke completed menjadwalkan perhitungan komisi', () => {
    const service = src('core/appointments/service.ts');
    expect(service).toContain('enqueueCommissionCalculation');
    expect(service).toMatch(/newStatus === 'completed'[\s\S]{0,120}enqueueCommissionCalculation/);
  });

  it('auto-complete oleh worker juga menjadwalkannya (jalur ini memanggil lifecycle langsung)', () => {
    const queue = src('lib/queue.ts');
    expect(queue).toMatch(/APPOINTMENT_AUTO_COMPLETE_TIMEOUT[\s\S]*enqueueCommissionCalculation/);
  });

  it('pembayaran yang lunas belakangan atas order selesai ikut menjadwalkannya', () => {
    const payments = src('core/payments/controller.ts');
    const occurrences = payments.match(/enqueueCommissionCalculation/g) ?? [];
    // Dua jalur: konfirmasi in-app dan webhook gateway.
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(payments).toContain("apt.status === 'completed'");
  });
});

describe('guard di dalam calculateCommission', () => {
  const commission = src('core/commissions/service.ts');

  it('menolak order yang belum selesai (mencegah komisi atas order batal)', () => {
    expect(commission).toContain("apt.status !== 'completed'");
  });

  it('memilih baris payment berstatus paid, bukan baris pertama', () => {
    expect(commission).toContain("paymentsArr.find((p: any) => p?.status === 'paid')");
    expect(commission).not.toContain('apt.payments[0]');
  });

  it('duplikat diberi kode agar job memperlakukannya sebagai sukses', () => {
    expect(commission).toContain('COMMISSION_ALREADY_RECORDED');
  });
});

describe('refund kesalahan penyedia', () => {
  it('no-show punya gerbang waktu dan mengembalikan dana', () => {
    const barber = src('core/appointments/barber.controller.ts');
    expect(barber).toContain('NO_SHOW_TOO_EARLY');
    expect(barber).toMatch(/markNoShow[\s\S]*settleProviderFaultRefund/);
  });

  it('worker no-show timeout juga mengembalikan dana', () => {
    const queue = src('lib/queue.ts');
    expect(queue).toMatch(/APPOINTMENT_NO_SHOW_TIMEOUT[\s\S]*settleProviderFaultRefund/);
  });

  it('kegagalan refund dijadwalkan ulang, tidak ditelan log', () => {
    const queue = src('lib/queue.ts');
    expect(queue).toMatch(/settleProviderFaultRefund[\s\S]*enqueueAppointmentRefund/);
  });

  it('admin punya jalur batalkan + refund (satu-satunya jalan keluar order lunas)', () => {
    expect(src('core/appointments/admin.controller.ts')).toContain('cancelWithRefund');
    expect(src('modules/admin/appointments/routes.ts')).toContain('cancel-with-refund');
  });
});

describe('batas pembayaran 1 jam', () => {
  it('default UNPAID_ORDER_EXPIRY_MINUTES adalah 60', () => {
    const queue = src('lib/queue.ts');
    expect(queue).toMatch(/UNPAID_ORDER_EXPIRY_MINUTES\s*=\s*parsePositiveInteger\(\s*process\.env\.UNPAID_ORDER_EXPIRY_MINUTES,\s*60/);
  });

  it('konstanta kembar ORDER_ACCEPTANCE_TIMEOUT_MINUTES sudah dihapus', () => {
    expect(src('lib/queue.ts')).not.toContain('ORDER_ACCEPTANCE_TIMEOUT_MINUTES');
  });

  it('tenggat bayar dikirim ke klien agar hitung mundur tidak bergantung jam perangkat', () => {
    expect(src('core/appointments/service.ts')).toContain('payment_deadline_at');
  });
});
