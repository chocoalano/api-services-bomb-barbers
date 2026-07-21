import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [KEBIJAKAN] Barber tidak diizinkan mengetahui pendapatannya.
 *
 * Menyembunyikan angka di aplikasi Flutter saja tidak cukup — begitu backend
 * kembali mengirimkan nominal, siapa pun yang memanggil endpointnya langsung
 * akan melihatnya lagi. Tes ini menjaga sisi backend: bentuk respons untuk
 * barber tidak boleh memuat field nominal, dan endpoint komisi/dompet barber
 * tidak boleh dipasang kembali tanpa disadari.
 *
 * Sengaja berbasis pembacaan sumber (bukan HTTP) supaya tetap berjalan di
 * lingkungan tanpa DB/Redis, sama seperti unit test lain di suite ini.
 */

/**
 * Baca sumber TANPA komentar. Tanpa ini, kalimat penjelas yang menyebut nama
 * field justru membuat tes gagal, dan komentar akan terus dipelintir agar tes
 * lulus — yang diperiksa harus kodenya, bukan prosanya.
 */
const src = (relative: string) =>
  readFileSync(join(import.meta.dir, '..', 'src', relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('respons barber tidak memuat nominal', () => {
  const appointmentService = src('core/appointments/service.ts');

  it('formatBarberQueueOrder & formatBarberHistoryOrder tidak lagi menghitung 40% hardcoded', () => {
    expect(appointmentService).not.toContain('* 0.4');
  });

  it('dashboard barber tidak mengirim total_earnings / tip_amount / barber_share', () => {
    const dashboard = src('core/dashboard/service.ts');
    const barberSection = dashboard.slice(
      dashboard.indexOf('getBarberTodayDashboard'),
      dashboard.indexOf('getHQTodayDashboard')
    );
    expect(barberSection).not.toContain('total_earnings');
    expect(barberSection).not.toContain('barber_share_including_tip');
    expect(barberSection).not.toContain('tip_amount:');
  });

  it('metrik kinerja non-uang tetap dikirim', () => {
    const dashboard = src('core/dashboard/service.ts');
    expect(dashboard).toContain('completed_today');
    expect(dashboard).toContain('heads_count');
  });
});

describe('permukaan baca pendapatan barber ditutup', () => {
  const barberRoutes = src('modules/barbers/routes.ts');

  it('rute komisi barber tidak dipasang', () => {
    expect(barberRoutes).not.toContain('.use(barberCommissionRoutes)');
  });

  it('rute dompet barber (termasuk withdraw) tidak dipasang', () => {
    expect(barberRoutes).not.toContain('.use(walletController)');
  });
});

describe('kebijakan pesanan customer', () => {
  it('endpoint edit order customer sudah dihapus', () => {
    const routes = src('modules/customers/appointments/routes.ts');
    expect(routes).not.toContain("CustomerAppointmentController.updateOrder");
    const service = src('core/appointments/service.ts');
    expect(service).not.toContain('static async updateBeforePayment');
  });

  it('pembatalan order lunas ditolak dengan kode PAID_ORDER_NOT_CANCELLABLE', () => {
    const controller = src('core/appointments/customer.controller.ts');
    expect(controller).toContain('PAID_ORDER_NOT_CANCELLABLE');
    expect(controller).toContain('hasPaidPayment');
  });
});
