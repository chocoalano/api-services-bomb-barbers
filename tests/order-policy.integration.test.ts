import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { testDb } from '../src/lib/test-db';
import { processAppointmentJob, COMMISSION_CALCULATE, PAID_ORDER_ESCALATION } from '../src/lib/queue';
import { revivePaidCancelledOrder } from '../src/core/appointments/late-payment-revival.service';
import { AppointmentLifecycleService } from '../src/core/appointments/lifecycle.service';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

/**
 * Kebijakan pesanan & uang (butuh DB + Redis, seperti suite integrasi lain).
 *
 *   - pesanan LUNAS tidak dapat dibatalkan customer  → PAID_ORDER_NOT_CANCELLABLE
 *   - pesanan BELUM lunas tetap dapat dibatalkan
 *   - endpoint edit order customer sudah tidak ada   → bukan 2xx
 *   - order selesai & lunas menghasilkan commission_entries otomatis
 *   - no-show sebelum jadwal ditolak                 → NO_SHOW_TOO_EARLY
 *   - respons antrean/dashboard barber tanpa nominal
 */
describe('Kebijakan pesanan & pendapatan', () => {
  let regionId = '';
  let branchId = '';
  let customerId = '';
  let barberStaffId = '';
  let barberId = '';
  let secondBarberId = '';
  let secondBarberStaffId = '';
  let serviceId = '';
  let customerToken = '';
  let barberToken = '';

  const createdAppointmentIds: string[] = [];
  let commissionRuleId = '';
  const password = 'Password123!';

  /** Buat appointment langsung di DB agar tes tidak bergantung aturan booking. */
  const seedAppointment = async (input: {
    status: string;
    scheduledAt: string;
    paid: boolean;
  }) => {
    const { data: apt } = await testDb
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'online_booking',
        status: input.status,
        scheduled_at: input.scheduledAt
      })
      .select('id')
      .single();

    const appointmentId = apt?.id as string;
    if (!appointmentId) throw new Error('Gagal menyiapkan appointment untuk tes');
    createdAppointmentIds.push(appointmentId);

    await testDb.from('appointment_services').insert({
      appointment_id: appointmentId,
      service_id: serviceId,
      price_amount: 50000,
      duration_min: 30
    });

    if (input.paid) {
      // Kolom wajib payments: branch_id, service_amount, product_amount.
      // Error insert TIDAK boleh ditelan — seed yang gagal diam-diam akan
      // membuat tes kebijakan "lulus" karena pesanannya ternyata belum lunas.
      const { error: payErr } = await testDb.from('payments').insert({
        appointment_id: appointmentId,
        branch_id: branchId,
        method: 'qris',
        status: 'paid',
        total_amount: 50000,
        service_amount: 50000,
        product_amount: 0
      });
      if (payErr) throw new Error(`Gagal menyiapkan payment lunas: ${payErr.message ?? payErr}`);
    }

    return appointmentId;
  };

  const hoursFromNow = (hours: number) =>
    new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  /**
   * Jadwal pada JAM BULAT, dengan offset BERBEDA per tes.
   *
   * Setiap order memakai blok 2 jam pada barbernya, sehingga tes yang memakai
   * jam sama akan saling membuat barber "sibuk" dan hasilnya menyesatkan.
   * Jarak 3 jam antar tes menjamin blok tidak pernah bertumpuk. Auto-assign & pengalihan memetakan jam booking ke
   * periode Open Order, dan pemetaan itu hanya mengenal jam bulat — persis
   * seperti jadwal yang dihasilkan alur booking sungguhan.
   */
  const roundHoursFromNow = (hours: number) => {
    const d = new Date(Date.now() + hours * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  };

  /** Sisipkan baris payment apa adanya — dipakai untuk mensimulasikan celah A6. */
  const seedRawPayment = async (appointmentId: string, method: string, status: string) => {
    const { error } = await testDb.from('payments').insert({
      appointment_id: appointmentId,
      branch_id: branchId,
      method,
      status,
      total_amount: 50000,
      service_amount: 50000,
      product_amount: 0
    });
    if (error) throw new Error(`Gagal menyiapkan payment: ${error.message ?? error}`);
  };

  beforeAll(async () => {
    const pwHash = await argon2.hash(password);
    const suffix = Date.now();
    const cPhone = `222${suffix}`;
    const bEmail = `policy-b${suffix}@test.com`;

    const { data: region } = await testDb
      .from('regions')
      .insert({ code: `P${suffix.toString().slice(-4)}`, name: 'Policy Region' })
      .select('id')
      .single();
    regionId = region?.id ?? '';

    const { data: branch } = await testDb
      .from('branches')
      .insert({
        name: 'Policy Branch',
        region_id: regionId,
        latitude: -6.260721,
        longitude: 106.813911
      })
      .select('id')
      .single();
    branchId = branch?.id ?? '';

    await testDb.from('branch_operating_hours').insert(
      Array.from({ length: 7 }, (_, day) => ({
        branch_id: branchId,
        day_of_week: day,
        open_time: '00:00:00',
        close_time: '23:59:59'
      }))
    );

    const { data: customer } = await testDb
      .from('customers')
      .insert({
        full_name: 'Policy C',
        email: `policy-c${suffix}@test.com`,
        phone: cPhone,
        password_hash: pwHash
      })
      .select('id')
      .single();
    customerId = customer?.id ?? '';

    const { data: staff } = await testDb
      .from('staff_users')
      .insert({ full_name: 'Policy B', email: bEmail, password_hash: pwHash })
      .select('id')
      .single();
    barberStaffId = staff?.id ?? '';

    const { data: barber } = await testDb
      .from('barbers')
      .insert({
        staff_user_id: barberStaffId,
        branch_id: branchId,
        display_name: 'Policy Barber'
      })
      .select('id')
      .single();
    barberId = barber?.id ?? '';

    // Barber kedua — kandidat pengalihan untuk order lunas yang menggantung.
    const { data: staff2 } = await testDb
      .from('staff_users')
      .insert({
        full_name: 'Policy B2',
        email: `policy-b2${suffix}@test.com`,
        password_hash: pwHash
      })
      .select('id')
      .single();
    secondBarberStaffId = staff2?.id ?? '';

    const { data: barber2 } = await testDb
      .from('barbers')
      .insert({
        staff_user_id: secondBarberStaffId,
        branch_id: branchId,
        display_name: 'Policy Barber 2',
        approval_status: 'approved',
        live_status: 'online'
      })
      .select('id')
      .single();
    secondBarberId = barber2?.id ?? '';

    const { data: svc } = await testDb
      .from('services')
      .insert({ name: 'Policy Cut', default_duration_min: 30 })
      .select('id')
      .single();
    serviceId = svc?.id ?? '';

    await testDb.from('service_prices').insert({
      service_id: serviceId,
      branch_id: branchId,
      price_amount: 50000,
      effective_from: new Date(Date.now() - 100000).toISOString()
    });

    // Aturan komisi global — tanpa ini calculateCommission melempar
    // "tidak ada aturan komisi aktif" dan komisi tidak akan tercatat.
    const { data: rule } = await testDb
      .from('commission_rules')
      .insert({
        scope: 'global',
        scope_ref_id: null,
        barber_pct: 50,
        branch_pct: 30,
        hq_pct: 20,
        tip_to_barber: true,
        effective_from: new Date(Date.now() - 100000).toISOString()
      })
      .select('id')
      .single();
    commissionRuleId = rule?.id ?? '';

    const loginC = await app
      .handle(
        new Request(`http://localhost${API_PREFIX}/customers/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: cPhone, password })
        })
      )
      .then((r) => r.json());
    customerToken = loginC?.data?.accessToken ?? '';

    const loginB = await app
      .handle(
        new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: bEmail, password })
        })
      )
      .then((r) => r.json());
    barberToken = loginB?.data?.accessToken ?? '';
  });

  afterAll(async () => {
    const ids = createdAppointmentIds.filter(Boolean);
    if (ids.length) {
      await testDb.from('commission_entries').delete().in('appointment_id', ids);
      await testDb.from('payments').delete().in('appointment_id', ids);
      await testDb.from('appointment_services').delete().in('appointment_id', ids);
      await testDb.from('appointment_events').delete().in('appointment_id', ids);
      await testDb.from('appointments').delete().in('id', ids);
    }
    if (commissionRuleId) {
      await testDb.from('commission_rules').delete().eq('id', commissionRuleId);
    }
    // Pencatatan komisi ikut membuat dompet + transaksi + agregat harian.
    // Tanpa dibersihkan, DELETE barbers di bawah akan tertahan foreign key.
    const { data: wallets } = await testDb
      .from('barber_wallets')
      .select('id')
      .eq('barber_id', barberId);
    const walletIds = (wallets ?? []).map((w: any) => w.id);
    if (walletIds.length) {
      await testDb.from('wallet_transactions').delete().in('wallet_id', walletIds);
      await testDb.from('barber_wallets').delete().in('id', walletIds);
    }
    await testDb.from('barber_daily_stats').delete().eq('barber_id', barberId);
    await testDb.from('daily_branch_summaries').delete().eq('branch_id', branchId);
    await testDb.from('service_prices').delete().eq('service_id', serviceId);
    await testDb.from('services').delete().eq('id', serviceId);
    await testDb.from('barbers').delete().eq('id', barberId);
    if (secondBarberId) await testDb.from('barbers').delete().eq('id', secondBarberId);
    await testDb.from('staff_users').delete().eq('id', barberStaffId);
    if (secondBarberStaffId) {
      await testDb.from('staff_users').delete().eq('id', secondBarberStaffId);
    }
    await testDb.from('customers').delete().eq('id', customerId);
    await testDb.from('branch_operating_hours').delete().eq('branch_id', branchId);
    await testDb.from('branches').delete().eq('id', branchId);
    await testDb.from('regions').delete().eq('id', regionId);
  });

  it('pesanan yang sudah dibayar TIDAK dapat dibatalkan customer', async () => {
    const appointmentId = await seedAppointment({
      status: 'confirmed',
      scheduledAt: hoursFromNow(8),
      paid: true
    });

    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/appointments/${appointmentId}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`
          },
          body: JSON.stringify({ reason: 'Berubah pikiran' })
        }
      )
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code ?? body.error?.code).toBe('PAID_ORDER_NOT_CANCELLABLE');

    const { data: after } = await testDb
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('confirmed');
  });

  it('pesanan yang BELUM dibayar tetap dapat dibatalkan', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: hoursFromNow(8),
      paid: false
    });

    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/appointments/${appointmentId}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`
          },
          body: JSON.stringify({ reason: 'Salah pilih jadwal' })
        }
      )
    );

    expect(res.status).toBe(200);
    const { data: after } = await testDb
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('cancelled');
  });

  it('endpoint edit order customer sudah tidak tersedia', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: hoursFromNow(8),
      paid: false
    });

    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/appointments/${appointmentId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`
          },
          body: JSON.stringify({ scheduled_at: hoursFromNow(10) })
        }
      )
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('no-show ditolak bila jadwalnya belum terlewat', async () => {
    const appointmentId = await seedAppointment({
      status: 'confirmed',
      scheduledAt: hoursFromNow(8),
      paid: true
    });

    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/barbers/appointments/${appointmentId}/no-show`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${barberToken}` }
        }
      )
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code ?? body.error?.code).toBe('NO_SHOW_TOO_EARLY');
  });

  it('respons antrean barber tidak memuat nominal apa pun', async () => {
    await seedAppointment({
      status: 'confirmed',
      scheduledAt: hoursFromNow(2),
      paid: true
    });

    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/barbers/queue`, {
        headers: { Authorization: `Bearer ${barberToken}` }
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    for (const order of body.data ?? []) {
      expect(order).not.toHaveProperty('price');
      // Status kelunasan tetap dikirim — itu pengganti nominal di app barber.
      expect(order).toHaveProperty('payment_status');
    }
  });

  it('dashboard barber tidak memuat field pendapatan', async () => {
    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/barbers/dashboard/today`, {
        headers: { Authorization: `Bearer ${barberToken}` }
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty('total_earnings');
    expect(body.data).not.toHaveProperty('barber_share_including_tip');
    expect(body.data).not.toHaveProperty('tip_amount');
    expect(body.data).toHaveProperty('completed_today');
  });

  it('endpoint komisi & dompet barber sudah tidak terpasang', async () => {
    for (const path of ['/barbers/commissions', '/barber/wallet']) {
      const res = await app.handle(
        new Request(`http://localhost${API_PREFIX}${path}`, {
          headers: { Authorization: `Bearer ${barberToken}` }
        })
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  // Inti temuan A1: dulu komisi HANYA tercatat bila admin menembak endpoint
  // manual. Sekarang order selesai menjadwalkan job COMMISSION_CALCULATE.
  // Worker in-process tidak berjalan saat test, jadi job-nya dieksekusi langsung.
  it('order selesai & lunas menghasilkan commission_entries tanpa campur tangan admin', async () => {
    const appointmentId = await seedAppointment({
      status: 'completed',
      scheduledAt: hoursFromNow(-2),
      paid: true
    });

    await processAppointmentJob({
      data: { type: COMMISSION_CALCULATE, appointmentId }
    } as any);

    const { data: entries } = await testDb
      .from('commission_entries')
      .select('id, barber_share, branch_share, hq_share')
      .eq('appointment_id', appointmentId);

    expect(entries?.length).toBe(1);
    expect(Number(entries?.[0]?.barber_share)).toBe(25000); // 50% dari 50.000
  });

  it('menjalankan job komisi dua kali tidak menggandakan entry', async () => {
    const appointmentId = await seedAppointment({
      status: 'completed',
      scheduledAt: hoursFromNow(-2),
      paid: true
    });

    const job = { data: { type: COMMISSION_CALCULATE, appointmentId } } as any;
    await processAppointmentJob(job);
    await processAppointmentJob(job);

    const { data: entries } = await testDb
      .from('commission_entries')
      .select('id')
      .eq('appointment_id', appointmentId);

    expect(entries?.length).toBe(1);
  });

  it('order yang dibatalkan tidak menghasilkan komisi walau pembayarannya lunas', async () => {
    const appointmentId = await seedAppointment({
      status: 'cancelled',
      scheduledAt: hoursFromNow(-2),
      paid: true
    });

    await processAppointmentJob({
      data: { type: COMMISSION_CALCULATE, appointmentId }
    } as any);

    const { data: entries } = await testDb
      .from('commission_entries')
      .select('id')
      .eq('appointment_id', appointmentId);

    expect(entries?.length ?? 0).toBe(0);
  });


  // ── A6: celah pembayaran tunai ────────────────────────────────────────────
  // Dulu `method` adalah string bebas dari body customer. Satu baris payment
  // 'cash' membuat order online tampil di antrean barber dan dijawab "tunai,
  // tidak perlu verifikasi" — dikerjakan tanpa satu rupiah pun masuk.

  it('customer tidak dapat memilih metode pembayaran tunai', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: hoursFromNow(8),
      paid: false
    });

    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/appointments/${appointmentId}/payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`
          },
          body: JSON.stringify({ method: 'cash' })
        }
      )
    );

    expect(res.status).toBeGreaterThanOrEqual(400);

    const { data: pay } = await testDb
      .from('payments')
      .select('id')
      .eq('appointment_id', appointmentId);
    expect(pay?.length ?? 0).toBe(0);
  });

  it('customer tetap dapat membayar lewat kanal online', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: hoursFromNow(8),
      paid: false
    });

    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/appointments/${appointmentId}/payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`
          },
          body: JSON.stringify({ method: 'qris' })
        }
      )
    );

    expect(res.status).toBe(201);
  });

  it('order online ber-payment tunai tidak muncul di antrean barber', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: hoursFromNow(2),
      paid: false
    });
    await seedRawPayment(appointmentId, 'cash', 'pending');

    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/barbers/queue`, {
        headers: { Authorization: `Bearer ${barberToken}` }
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect((body.data ?? []).some((o: any) => o.id === appointmentId)).toBe(false);
  });

  it('order walk-in tunai TETAP muncul di antrean barber (regresi)', async () => {
    const { data: apt } = await testDb
      .from('appointments')
      .insert({
        branch_id: branchId,
        barber_id: barberId,
        customer_id: customerId,
        source: 'walk_in',
        status: 'pending',
        scheduled_at: hoursFromNow(2)
      })
      .select('id')
      .single();
    const appointmentId = apt?.id as string;
    createdAppointmentIds.push(appointmentId);
    await testDb.from('appointment_services').insert({
      appointment_id: appointmentId,
      service_id: serviceId,
      price_amount: 50000,
      duration_min: 30
    });
    await seedRawPayment(appointmentId, 'cash', 'pending');

    const res = await app.handle(
      new Request(`http://localhost${API_PREFIX}/barbers/queue`, {
        headers: { Authorization: `Bearer ${barberToken}` }
      })
    );
    const body = await res.json();

    expect((body.data ?? []).some((o: any) => o.id === appointmentId)).toBe(true);
  });

  it('barber tidak dapat menerima order online yang belum lunas', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: hoursFromNow(2),
      paid: false
    });
    await seedRawPayment(appointmentId, 'cash', 'pending');

    const res = await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/barbers/appointments/${appointmentId}/accept`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${barberToken}` }
        }
      )
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code ?? body.error?.code).toBe('ORDER_NOT_PAID');

    const { data: after } = await testDb
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('pending');
  });


  // ── B1: order lunas yang tidak kunjung diterima barber ────────────────────
  // Dulu tidak punya jalur keluar sama sekali: acceptance timeout melewati order
  // lunas, no-show timeout hanya menyentuh confirmed/in_queue.

  it('order lunas yang menggantung dialihkan ke barber lain, status tetap pending', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: roundHoursFromNow(3),
      paid: true
    });

    await processAppointmentJob({
      data: { type: PAID_ORDER_ESCALATION, appointmentId, finalStage: false }
    } as any);

    const { data: after } = await testDb
      .from('appointments')
      .select('status, barber_id')
      .eq('id', appointmentId)
      .single();

    expect(after?.status).toBe('pending');
    expect(after?.barber_id).toBe(secondBarberId);

    const { data: events } = await testDb
      .from('appointment_events')
      .select('id')
      .eq('appointment_id', appointmentId)
      .eq('event_type', 'PAID_ORDER_REASSIGNED');
    expect(events?.length).toBe(1);
  });

  it('pengalihan berhenti setelah batas percobaan, lalu dibatalkan + direfund', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: roundHoursFromNow(6),
      paid: true
    });

    const job = {
      data: { type: PAID_ORDER_ESCALATION, appointmentId, finalStage: false }
    } as any;

    // Hanya ada dua barber, jadi percobaan kedua sudah kehabisan kandidat.
    await processAppointmentJob(job);
    await processAppointmentJob(job);

    const { data: after } = await testDb
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('cancelled');

    const { data: pay } = await testDb
      .from('payments')
      .select('status')
      .eq('appointment_id', appointmentId)
      .single();
    expect(pay?.status).toBe('refunded');
  });

  it('tahap terakhir langsung membatalkan tanpa mencoba mengalihkan lagi', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: roundHoursFromNow(9),
      paid: true
    });

    await processAppointmentJob({
      data: { type: PAID_ORDER_ESCALATION, appointmentId, finalStage: true }
    } as any);

    const { data: after } = await testDb
      .from('appointments')
      .select('status, barber_id')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('cancelled');
    expect(after?.barber_id).toBe(barberId);
  });

  it('order BELUM lunas tidak disentuh eskalasi (tetap urusan acceptance timeout)', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: roundHoursFromNow(12),
      paid: false
    });

    await processAppointmentJob({
      data: { type: PAID_ORDER_ESCALATION, appointmentId, finalStage: false }
    } as any);

    const { data: after } = await testDb
      .from('appointments')
      .select('status, barber_id')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('pending');
    expect(after?.barber_id).toBe(barberId);
  });

  it('order yang sudah diterima barber tidak dialihkan', async () => {
    const appointmentId = await seedAppointment({
      status: 'confirmed',
      scheduledAt: roundHoursFromNow(15),
      paid: true
    });

    await processAppointmentJob({
      data: { type: PAID_ORDER_ESCALATION, appointmentId, finalStage: false }
    } as any);

    const { data: after } = await testDb
      .from('appointments')
      .select('status, barber_id')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('confirmed');
    expect(after?.barber_id).toBe(barberId);
  });


  // ── A4: pembayaran telat atas order yang sudah dibatalkan ─────────────────
  // `cancelled` adalah status terminal; revival membuka satu-satunya pintu
  // keluar, dan pintu itu harus tetap tertutup untuk semua jalur lain.

  /** Batalkan order persis seperti worker batas-bayar melakukannya. */
  const cancelByPaymentTimeout = async (appointmentId: string) => {
    await AppointmentLifecycleService.transition(appointmentId, 'cancelled', {
      actor: { type: 'system', id: null, role: 'system' },
      event_type: 'ORDER_ACCEPTANCE_TIMEOUT',
      reason: 'Order dibatalkan otomatis karena belum dibayar'
    });
  };

  it('order yang dibatalkan sistem dihidupkan kembali saat pembayaran menyusul', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: roundHoursFromNow(18),
      paid: false
    });
    await cancelByPaymentTimeout(appointmentId);
    await seedRawPayment(appointmentId, 'qris', 'paid');

    const outcome = await revivePaidCancelledOrder(appointmentId);
    expect(outcome.action).toBe('revived');

    const { data: after } = await testDb
      .from('appointments')
      .select('status, journey_status, cancellation_reason')
      .eq('id', appointmentId)
      .single();

    expect(after?.status).toBe('pending');
    // Kolom yang ikut "mati" saat pembatalan harus dipulihkan.
    expect(after?.journey_status).toBe('not_started');
    expect(after?.cancellation_reason).toBeNull();
  });

  it('tidak dihidupkan bila jadwalnya sudah terlalu dekat', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      paid: false
    });
    await cancelByPaymentTimeout(appointmentId);
    await seedRawPayment(appointmentId, 'qris', 'paid');

    const outcome = await revivePaidCancelledOrder(appointmentId);
    expect(outcome.action).toBe('not_eligible');
    expect((outcome as any).reason).toBe('schedule_too_close');

    const { data: after } = await testDb
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('cancelled');
  });

  it('pembatalan oleh CUSTOMER tidak pernah dihidupkan kembali', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: roundHoursFromNow(21),
      paid: false
    });

    await app.handle(
      new Request(
        `http://localhost${API_PREFIX}/customers/appointments/${appointmentId}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`
          },
          body: JSON.stringify({ reason: 'Berubah pikiran' })
        }
      )
    );
    await seedRawPayment(appointmentId, 'qris', 'paid');

    const outcome = await revivePaidCancelledOrder(appointmentId);
    expect(outcome.action).toBe('not_eligible');
    expect((outcome as any).reason).toBe('not_cancelled_by_timeout');
  });

  it('pintu cancelled → pending tetap tertutup untuk transisi biasa', async () => {
    const appointmentId = await seedAppointment({
      status: 'pending',
      scheduledAt: roundHoursFromNow(24),
      paid: false
    });
    await cancelByPaymentTimeout(appointmentId);

    let threw = false;
    try {
      await AppointmentLifecycleService.transition(appointmentId, 'pending', {
        actor: { type: 'staff', id: barberStaffId, role: 'admin' },
        reason: 'Coba buka kembali lewat jalur biasa'
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const { data: after } = await testDb
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .single();
    expect(after?.status).toBe('cancelled');
  });

  it('order yang masih hidup tidak tersentuh revival', async () => {
    const appointmentId = await seedAppointment({
      status: 'confirmed',
      scheduledAt: roundHoursFromNow(27),
      paid: true
    });

    const outcome = await revivePaidCancelledOrder(appointmentId);
    expect(outcome.action).toBe('not_eligible');
    expect((outcome as any).reason).toBe('not_cancelled');
  });

});
