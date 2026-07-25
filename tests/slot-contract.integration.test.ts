import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { AppointmentService } from '../src/core/appointments/service';
import { AvailabilityService } from '../src/modules/customers/availability/service';
import { BOOKING_CONFIG, minutesToTime } from '../src/config/booking';
import { testDb } from '../src/lib/test-db';

/**
 * KONTRAK GENERATOR ↔ PENEGAK (revisi E1–E8).
 *
 * Rencana: `plans/audit/revisi/e1_e8_satu_sumber_aturan_slot_2026-07-21.md`
 *
 * Satu invarian yang menggantikan delapan bug terpisah:
 *
 *     slot yang DITAWARKAN /available-slots  → createAppointment HARUS berhasil
 *     slot yang TIDAK ditawarkan            → createAppointment HARUS gagal
 *
 * Tanpa kontrak ini, memperbaiki satu ketidakcocokan bisa menukarnya dengan
 * ketidakcocokan lain tanpa ketahuan — tidak ada satu pun tes lama yang
 * menyentuh `pickBestAvailableBarber`, cakupan kuota, atau kode
 * INVALID_SLOT/TOO_SOON/BARBER_QUOTA_FULL.
 *
 * Suite ini membuat fixture-nya sendiri (region/branch/barber/customer/service)
 * dan membersihkannya di akhir, jadi aman dijalankan atas database dev yang
 * sudah berisi data — tidak butuh reset maupun seed.
 */
describe('Kontrak slot: yang ditawarkan harus bisa dipesan', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = 'Password123!';

  let regionId = '';
  let branchId = '';
  let customerId = '';
  let serviceId = '';

  /** Barber utama — dipakai sebagian besar skenario. */
  let barberId = '';

  const createdAppointmentIds: string[] = [];
  const createdBarberIds: string[] = [];
  const createdStaffIds: string[] = [];
  const createdTimeOffIds: string[] = [];
  const createdServiceIds: string[] = [];

  // ── Utilitas waktu ────────────────────────────────────────────────────────

  /** Tanggal kalender Jakarta `YYYY-MM-DD`, `daysFromNow` hari dari sekarang. */
  const jakartaDate = (daysFromNow: number) => {
    const ref = new Date(Date.now() + daysFromNow * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BOOKING_CONFIG.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(ref);
  };

  /** ISO instant untuk jam WIB tertentu pada tanggal tersebut. */
  const at = (date: string, hour: number) =>
    new Date(
      `${date}T${String(hour).padStart(2, '0')}:00:00${BOOKING_CONFIG.timezoneOffset}`
    ).toISOString();

  /**
   * Tanggal uji: 3 hari ke depan. Cukup jauh dari jeda minimal 6 jam sehingga
   * seluruh rentang 08:00–22:00 memenuhi syarat lead time, dan hasilnya tidak
   * bergantung pada jam berapa suite dijalankan.
   */
  const TEST_DATE = jakartaDate(3);

  // ── Utilitas fixture ──────────────────────────────────────────────────────

  const newBarber = async (opts: {
    label: string;
    liveStatus?: string;
    staffActive?: boolean;
    branch?: string;
  }) => {
    const { data: staff } = await testDb
      .from('staff_users')
      .insert({
        full_name: `Contract ${opts.label}`,
        email: `contract-${opts.label}-${suffix}@test.com`,
        password_hash: await argon2.hash(password),
        is_active: opts.staffActive ?? true
      })
      .select('id')
      .single();
    const staffId = staff?.id as string;
    createdStaffIds.push(staffId);

    const { data: barber } = await testDb
      .from('barbers')
      .insert({
        staff_user_id: staffId,
        branch_id: opts.branch ?? branchId,
        display_name: `Contract ${opts.label}`,
        approval_status: 'approved',
        live_status: opts.liveStatus ?? 'online'
      })
      .select('id')
      .single();
    const id = barber?.id as string;
    createdBarberIds.push(id);
    return { id, staffId };
  };

  /**
   * Layanan tambahan dengan durasi tertentu — dipakai skenario E1/E11 yang
   * justru bergantung pada durasi. Harga diisi di `service_prices` karena di
   * situlah prosedur atomik mencarinya.
   */
  const newService = async (label: string, durationMin: number) => {
    const { data } = await testDb
      .from('services')
      .insert({ name: `Contract ${label} ${suffix}`, default_duration_min: durationMin })
      .select('id')
      .single();
    const id = data?.id as string;
    createdServiceIds.push(id);

    await testDb.from('branch_services').insert({
      branch_id: branchId,
      service_id: id,
      price_amount: 50000
    });
    await testDb.from('service_prices').insert({
      service_id: id,
      branch_id: branchId,
      price_amount: 50000,
      effective_from: '2020-01-01 00:00:00'
    });
    return id;
  };

  /**
   * Sisipkan appointment langsung ke DB agar penyiapan skenario tidak
   * bergantung pada aturan booking yang justru sedang diuji.
   */
  const seedAppointment = async (input: {
    barberId: string | null;
    scheduledAt: string;
    branch?: string;
    status?: string;
    /** Sengaja biarkan kolom blok kosong — skenario E10. */
    withBlock?: boolean;
    durationMin?: number;
  }) => {
    const durationMin = input.durationMin ?? 30;
    const start = new Date(input.scheduledAt);
    const end = new Date(start.getTime() + durationMin * 60_000);
    const row: Record<string, unknown> = {
      branch_id: input.branch ?? branchId,
      barber_id: input.barberId,
      customer_id: customerId,
      source: 'online_booking',
      status: input.status ?? 'confirmed',
      scheduled_at: input.scheduledAt,
      scheduled_end_at: end.toISOString()
    };
    if (input.withBlock !== false) {
      row.schedule_block_start_at = input.scheduledAt;
      row.schedule_block_end_at = end.toISOString();
    }

    const { data } = await testDb.from('appointments').insert(row).select('id').single();
    const id = data?.id as string;
    if (!id) throw new Error('Gagal menyiapkan appointment');
    createdAppointmentIds.push(id);
    return id;
  };

  const clearAppointmentsFor = async (targetBarberId: string) => {
    await testDb.from('appointments').delete().eq('barber_id', targetBarberId);
    // Baris yang kita catat mungkin sudah terhapus; biarkan cleanup akhir
    // menangani sisanya secara idempoten.
  };

  // ── Dua sisi kontrak ──────────────────────────────────────────────────────

  /** Daftar jam ('HH:MM') yang ditawarkan generator untuk tanggal uji. */
  const offeredTimes = async (
    opts: { barberId?: string; serviceIds?: string[]; branch?: string } = {}
  ) => {
    const result = await AvailabilityService.getAvailableSlots(opts.branch ?? branchId, {
      date: TEST_DATE,
      service_ids: opts.serviceIds ?? [serviceId],
      ...(opts.barberId ? { barber_id: opts.barberId } : {})
    } as any);
    return ((result as any).slots ?? []).map((s: any) => s.time as string);
  };

  /** Satu slot penuh (termasuk `available_barber_ids`) untuk jam tertentu. */
  const offeredSlot = async (
    time: string,
    opts: { barberId?: string; serviceIds?: string[] } = {}
  ) => {
    const result = await AvailabilityService.getAvailableSlots(branchId, {
      date: TEST_DATE,
      service_ids: opts.serviceIds ?? [serviceId],
      ...(opts.barberId ? { barber_id: opts.barberId } : {})
    } as any);
    return ((result as any).slots ?? []).find((s: any) => s.time === time) ?? null;
  };

  type BookResult = { ok: true; id: string } | { ok: false; code?: string; message: string };

  /** Sisi penegak: coba pesan sungguhan lalu laporkan hasilnya. */
  const tryBook = async (
    scheduledAt: string,
    opts: { barberId?: string | null; serviceIds?: string[]; branch?: string } = {}
  ): Promise<BookResult> => {
    try {
      const result: any = await AppointmentService.createAppointment(
        {
          branch_id: opts.branch ?? branchId,
          barber_id: opts.barberId ?? null,
          customer_id: customerId,
          service_ids: opts.serviceIds ?? [serviceId],
          scheduled_at: scheduledAt,
          idempotency_key: `contract-${randomUUID()}`,
          fulfillment_type: 'in_store'
        } as any,
        'online_booking',
        { type: 'customer', id: customerId } as any
      );
      const id = result?.id ?? result?.appointment?.id;
      if (id) createdAppointmentIds.push(id);
      return { ok: true, id };
    } catch (error: any) {
      return { ok: false, code: error?.code, message: String(error?.message ?? error) };
    }
  };

  /** Batalkan efek `tryBook` agar skenario berikutnya mulai dari state bersih. */
  const undoBooking = async (result: BookResult) => {
    if (result.ok && result.id) {
      await testDb.from('appointment_services').delete().eq('appointment_id', result.id);
      await testDb.from('appointment_events').delete().eq('appointment_id', result.id);
      await testDb.from('appointments').delete().eq('id', result.id);
    }
  };

  // ── Setup / teardown ──────────────────────────────────────────────────────

  beforeAll(async () => {
    const { data: region } = await testDb
      .from('regions')
      .insert({ code: `C${suffix.slice(-5)}`, name: 'Contract Region' })
      .select('id')
      .single();
    regionId = region?.id ?? '';

    const { data: branch } = await testDb
      .from('branches')
      .insert({
        name: 'Contract Branch',
        region_id: regionId,
        latitude: -6.260721,
        longitude: 106.813911
      })
      .select('id')
      .single();
    branchId = branch?.id ?? '';

    // Jam operasional persis seperti aturan booking: buka 08:00, dan
    // `close_time` = batas jam MULAI slot terakhir (22:00). Inilah konfigurasi
    // yang memunculkan E1 — lihat §6.1 rencana.
    await testDb.from('branch_operating_hours').insert(
      Array.from({ length: 7 }, (_, day) => ({
        branch_id: branchId,
        day_of_week: day,
        open_time: minutesToTime(BOOKING_CONFIG.operationalStartMinutes) + ':00',
        close_time: minutesToTime(BOOKING_CONFIG.operationalLastBookingMinutes) + ':00'
      }))
    );

    const { data: customer } = await testDb
      .from('customers')
      .insert({
        full_name: 'Contract C',
        email: `contract-c-${suffix}@test.com`,
        phone: `555${Date.now()}`.slice(0, 15),
        password_hash: await argon2.hash(password)
      })
      .select('id')
      .single();
    customerId = customer?.id ?? '';

    const { data: svc } = await testDb
      .from('services')
      .insert({ name: `Contract Cut ${suffix}`, default_duration_min: 30 })
      .select('id')
      .single();
    serviceId = svc?.id ?? '';

    await testDb.from('branch_services').insert({
      branch_id: branchId,
      service_id: serviceId,
      price_amount: 50000
    });

    // Prosedur atomik mengambil harga dari `service_prices`, BUKAN dari
    // `branch_services` — tanpa baris ini setiap booking ditolak P0002
    // "Harga layanan tidak tersedia" walau slotnya ditawarkan generator.
    await testDb.from('service_prices').insert({
      service_id: serviceId,
      branch_id: branchId,
      price_amount: 50000,
      effective_from: '2020-01-01 00:00:00'
    });

    const main = await newBarber({ label: 'main' });
    barberId = main.id;
  });

  afterAll(async () => {
    for (const id of createdAppointmentIds) {
      await testDb.from('appointment_services').delete().eq('appointment_id', id);
      await testDb.from('appointment_events').delete().eq('appointment_id', id);
    }
    for (const id of createdBarberIds) {
      await testDb.from('appointments').delete().eq('barber_id', id);
      await testDb.from('barber_time_off').delete().eq('barber_id', id);
    }
    await testDb.from('appointments').delete().eq('branch_id', branchId);
    for (const id of createdTimeOffIds) {
      await testDb.from('barber_time_off').delete().eq('id', id);
    }
    for (const id of createdBarberIds) await testDb.from('barbers').delete().eq('id', id);
    for (const id of createdStaffIds) await testDb.from('staff_users').delete().eq('id', id);
    await testDb.from('branch_services').delete().eq('branch_id', branchId);
    for (const id of [serviceId, ...createdServiceIds]) {
      await testDb.from('service_prices').delete().eq('service_id', id);
      await testDb.from('services').delete().eq('id', id);
    }
    await testDb.from('customers').delete().eq('id', customerId);
    await testDb.from('branch_operating_hours').delete().eq('branch_id', branchId);
    await testDb.from('branches').delete().eq('id', branchId);
    await testDb.from('regions').delete().eq('id', regionId);
  });

  // ── Sanity: kontrak dasar terpenuhi pada state bersih ─────────────────────

  it('slot yang ditawarkan pada barber bebas memang bisa dipesan', async () => {
    const times = await offeredTimes({ barberId });
    expect(times.length).toBeGreaterThan(0);

    const result = await tryBook(at(TEST_DATE, 10), { barberId });
    expect(times).toContain('10:00');
    // Tampilkan alasan penolakannya: pesan "expected true, got false" tidak
    // memberi tahu apa pun saat kontrak ini pecah.
    expect(result.ok ? 'ok' : `${(result as any).code}: ${(result as any).message}`).toBe('ok');
    await undoBooking(result);
  });

  it('jam di luar 08:00–22:00 tidak ditawarkan dan memang ditolak', async () => {
    const times = await offeredTimes({ barberId });
    expect(times).not.toContain('07:00');
    expect(times).not.toContain('23:00');

    const early = await tryBook(at(TEST_DATE, 7), { barberId });
    expect(early.ok).toBe(false);
    expect((early as any).code).toBe('OUTSIDE_WORKING_HOURS');
  });

  // ── E2: auto-assign vs barber cuti ────────────────────────────────────────

  it('E2 — auto-assign tidak boleh memilih barber yang sedang cuti', async () => {
    // Satu-satunya barber di cabang ini sedang cuti sepanjang hari uji.
    const { data: timeOff } = await testDb
      .from('barber_time_off')
      .insert({
        barber_id: barberId,
        start_at: at(TEST_DATE, 0),
        end_at: at(TEST_DATE, 23),
        status: 'approved',
        reason: 'kontrak-test'
      })
      .select('id')
      .single();
    createdTimeOffIds.push(timeOff?.id as string);

    try {
      // Generator sudah benar: tidak ada slot sama sekali.
      const times = await offeredTimes();
      expect(times).toEqual([]);

      // Maka auto-assign juga harus menolak — bukan memilih barber cuti itu
      // lalu ditolak prosedur dengan P0001.
      const result = await tryBook(at(TEST_DATE, 10), { barberId: null });
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe('NO_BARBER_AVAILABLE');
      await undoBooking(result);
    } finally {
      await testDb.from('barber_time_off').delete().eq('barber_id', barberId);
    }
  });

  // ── E3: staff nonaktif ────────────────────────────────────────────────────

  it('E3 — barber dengan staff nonaktif tidak ditawarkan', async () => {
    const inactive = await newBarber({ label: 'inactive', staffActive: false });

    // Barber utama dibuat "tidak idle" agar hanya kandidat nonaktif yang tersisa.
    await testDb.from('barbers').update({ live_status: 'offline' }).eq('id', barberId);
    try {
      const slot = await offeredSlot('10:00');
      const ids: string[] = slot?.available_barber_ids ?? [];
      expect(ids).not.toContain(inactive.id);

      // Dan penegak memang menolaknya (P0002 → 404).
      const result = await tryBook(at(TEST_DATE, 10), { barberId: inactive.id });
      expect(result.ok).toBe(false);
      await undoBooking(result);
    } finally {
      await testDb.from('barbers').update({ live_status: 'online' }).eq('id', barberId);
    }
  });

  it('E3 — auto-assign tidak boleh memilih barber dengan staff nonaktif', async () => {
    const inactive = await newBarber({ label: 'inactive2', staffActive: false });
    await testDb.from('barbers').update({ live_status: 'offline' }).eq('id', barberId);
    try {
      const result = await tryBook(at(TEST_DATE, 11), { barberId: null });
      // Boleh gagal NO_BARBER_AVAILABLE; yang TIDAK boleh adalah memilih
      // barber nonaktif lalu ditolak prosedur.
      if (result.ok) {
        const { data: created } = await testDb
          .from('appointments')
          .select('barber_id')
          .eq('id', result.id)
          .single();
        expect(created?.barber_id).not.toBe(inactive.id);
      } else {
        expect((result as any).code).toBe('NO_BARBER_AVAILABLE');
      }
      await undoBooking(result);
    } finally {
      await testDb.from('barbers').update({ live_status: 'online' }).eq('id', barberId);
    }
  });

  // ── E7: cakupan kuota ─────────────────────────────────────────────────────

  it('E7 — kuota dihitung dengan cakupan yang sama oleh generator dan penegak', async () => {
    // Cabang kedua, barber yang sama tidak mungkin — jadi simulasikan order
    // milik barber ini yang tercatat di cabang lain.
    const { data: otherBranch } = await testDb
      .from('branches')
      .insert({
        name: 'Contract Branch 2',
        region_id: regionId,
        latitude: -6.26,
        longitude: 106.81
      })
      .select('id')
      .single();
    const otherBranchId = otherBranch?.id as string;

    try {
      // Penuhi kuota lewat order di cabang LAIN.
      for (let i = 0; i < BOOKING_CONFIG.maxDailyOrdersPerBarber; i++) {
        await seedAppointment({
          barberId,
          branch: otherBranchId,
          // Jam berjauhan agar tidak saling memblok; yang diuji kuota, bukan bentrok.
          scheduledAt: at(TEST_DATE, 8 + i)
        });
      }

      const slot = await offeredSlot('20:00', { barberId });
      const result = await tryBook(at(TEST_DATE, 20), { barberId });

      // Kontrak: kalau penegak bilang kuota penuh, generator tidak boleh
      // menawarkannya — dan sebaliknya.
      if (!result.ok && (result as any).code === 'BARBER_QUOTA_FULL') {
        expect(slot).toBeNull();
      } else {
        expect(slot).not.toBeNull();
      }
      await undoBooking(result);
    } finally {
      await testDb.from('appointments').delete().eq('branch_id', otherBranchId);
      await testDb.from('branches').delete().eq('id', otherBranchId);
      await clearAppointmentsFor(barberId);
    }
  });

  // ── E10: blok NULL ────────────────────────────────────────────────────────

  it('E10 — order dengan schedule_block kosong tetap memblok slotnya', async () => {
    await seedAppointment({
      barberId,
      scheduledAt: at(TEST_DATE, 14),
      withBlock: false
    });

    try {
      const slot = await offeredSlot('14:00', { barberId });
      const result = await tryBook(at(TEST_DATE, 14), { barberId });

      // Generator memakai fallback `scheduled_at` sehingga menyembunyikan slot;
      // penegak melewatkan baris ber-kolom NULL sehingga menerimanya.
      expect(slot).toBeNull();
      expect(result.ok).toBe(false);
      await undoBooking(result);
    } finally {
      await clearAppointmentsFor(barberId);
    }
  });

  // ── E12: efek samping sebelum validasi ────────────────────────────────────

  it('E12 — booking yang gagal tidak boleh membatalkan order pending customer', async () => {
    const pendingId = await seedAppointment({
      barberId,
      scheduledAt: at(TEST_DATE, 16),
      status: 'pending'
    });

    try {
      // Booking yang PASTI gagar di tahap validasi barber: barber tidak idle.
      await testDb.from('barbers').update({ live_status: 'offline' }).eq('id', barberId);
      const result = await tryBook(at(TEST_DATE, 9), { barberId: null });
      expect(result.ok).toBe(false);

      const { data: after } = await testDb
        .from('appointments')
        .select('status')
        .eq('id', pendingId)
        .single();
      expect(after?.status).toBe('pending');
      await undoBooking(result);
    } finally {
      await testDb.from('barbers').update({ live_status: 'online' }).eq('id', barberId);
      await clearAppointmentsFor(barberId);
    }
  });

  // ── E1: layanan wajib selesai sebelum jam tutup ───────────────────────────
  // Keputusan klien 2026-07-21: TIDAK boleh melewati `close_time`. Jadi jam
  // mulai terakhir bergantung durasi layanan, dan generator harus ikut.

  it('E1 — slot 22:00 tidak lagi ditawarkan untuk layanan 60 menit', async () => {
    const service60 = await newService('e1-60', 60);
    try {
      const times = await offeredTimes({ barberId, serviceIds: [service60] });
      expect(times).not.toContain('22:00');
      expect(times).toContain('21:00');

      // Dan yang ditawarkan memang bisa dipesan.
      const ok = await tryBook(at(TEST_DATE, 21), { barberId, serviceIds: [service60] });
      expect(ok.ok ? 'ok' : `${(ok as any).code}: ${(ok as any).message}`).toBe('ok');
      await undoBooking(ok);

      // Sedangkan 22:00 ditolak — dulu ditawarkan lalu gagal di prosedur.
      const rejected = await tryBook(at(TEST_DATE, 22), { barberId, serviceIds: [service60] });
      expect(rejected.ok).toBe(false);
      expect((rejected as any).code).toBe('OUTSIDE_WORKING_HOURS');
      await undoBooking(rejected);
    } finally {
      await clearAppointmentsFor(barberId);
    }
  });

  it('E1 — layanan 90 menit kehilangan 21:00, masih punya 20:00', async () => {
    const service90 = await newService('e1-90', 90);
    const times = await offeredTimes({ barberId, serviceIds: [service90] });
    expect(times).not.toContain('21:00');
    expect(times).toContain('20:00');
  });

  // ── E4: cabang tanpa jam operasional ──────────────────────────────────────

  it('E4 — cabang tanpa branch_operating_hours tidak menawarkan slot apa pun', async () => {
    const { data: bareBranch } = await testDb
      .from('branches')
      .insert({
        name: 'Contract Bare Branch',
        region_id: regionId,
        latitude: -6.26,
        longitude: 106.81
      })
      .select('id')
      .single();
    const bareBranchId = bareBranch?.id as string;
    const bareBarber = await newBarber({ label: 'bare', branch: bareBranchId });

    try {
      // Generator ikut fail-closed, sama seperti penegak.
      const times = await offeredTimes({ branch: bareBranchId });
      expect(times).toEqual([]);

      const result = await tryBook(at(TEST_DATE, 10), {
        branch: bareBranchId,
        barberId: bareBarber.id
      });
      expect(result.ok).toBe(false);
      await undoBooking(result);
    } finally {
      await testDb.from('appointments').delete().eq('branch_id', bareBranchId);
      await testDb.from('barbers').delete().eq('id', bareBarber.id);
      await testDb.from('branches').delete().eq('id', bareBranchId);
    }
  });

  // ── E5/E11: definisi blok okupansi ────────────────────────────────────────

  it('E5 — order kedua di dalam blok 2 jam ditolak penegak, bukan hanya pre-check', async () => {
    // Order 09:00 layanan 30 menit → blok 09:00–11:00.
    await seedAppointment({ barberId, scheduledAt: at(TEST_DATE, 9) });
    try {
      const slot = await offeredSlot('10:00', { barberId });
      const result = await tryBook(at(TEST_DATE, 10), { barberId });

      // Dua sisi kontrak harus sepakat: tidak ditawarkan DAN ditolak.
      expect(slot).toBeNull();
      expect(result.ok).toBe(false);
      await undoBooking(result);
    } finally {
      await clearAppointmentsFor(barberId);
    }
  });

  it('E11 — layanan gabungan >2 jam mengunci sepanjang durasinya', async () => {
    const service150 = await newService('e11-150', 150);
    // 09:00 + 150 menit = 11:30, jadi 11:00 harus ikut terblokir.
    const booked = await tryBook(at(TEST_DATE, 9), { barberId, serviceIds: [service150] });
    expect(booked.ok ? 'ok' : `${(booked as any).code}: ${(booked as any).message}`).toBe('ok');

    try {
      const slot = await offeredSlot('11:00', { barberId });
      const second = await tryBook(at(TEST_DATE, 11), { barberId });
      expect(slot).toBeNull();
      expect(second.ok).toBe(false);
      await undoBooking(second);
    } finally {
      await undoBooking(booked);
      await clearAppointmentsFor(barberId);
    }
  });

  // ── E6: semantik available_barber_ids ─────────────────────────────────────

  it('E6 — setiap id di available_barber_ids benar-benar bisa dipesan', async () => {
    const extraA = await newBarber({ label: 'e6a' });
    const extraB = await newBarber({ label: 'e6b' });
    // Satu order TANPA barber: dulu memicu slice() yang membuang kandidat bebas
    // berdasarkan urutan query.
    await seedAppointment({ barberId: null, scheduledAt: at(TEST_DATE, 13) });

    try {
      const slot = await offeredSlot('13:00');
      expect(slot).not.toBeNull();
      const ids: string[] = slot.available_barber_ids ?? [];

      // Ketiga barber bebas harus tercantum, bukan dipotong sebanyak kapasitas.
      expect(ids).toContain(barberId);
      expect(ids).toContain(extraA.id);
      expect(ids).toContain(extraB.id);
      // Kapasitas efektif tetap dikurangi order tanpa barber.
      expect(slot.available_barber_count).toBe(ids.length - 1);

      for (const id of ids) {
        const result = await tryBook(at(TEST_DATE, 13), { barberId: id });
        expect(
          result.ok ? 'ok' : `${id} → ${(result as any).code}: ${(result as any).message}`
        ).toBe('ok');
        await undoBooking(result);
      }
    } finally {
      await testDb.from('appointments').delete().eq('branch_id', branchId);
    }
  });

  // ── E8: kamus status barber ───────────────────────────────────────────────

  it('E8 — barber on_break (admin) maupun unavailable (app barber) tidak ditawarkan', async () => {
    for (const status of ['on_break', 'unavailable', 'serving', 'offline']) {
      await testDb.from('barbers').update({ live_status: status }).eq('id', barberId);

      const slot = await offeredSlot('12:00', { barberId });
      expect(slot).toBeNull();

      const result = await tryBook(at(TEST_DATE, 12), { barberId });
      expect(result.ok).toBe(false);
      await undoBooking(result);
    }

    // 'online' (istilah lama app barber) tetap dikenali sebagai siap menerima.
    await testDb.from('barbers').update({ live_status: 'online' }).eq('id', barberId);
    expect(await offeredSlot('12:00', { barberId })).not.toBeNull();

    await testDb.from('barbers').update({ live_status: 'available' }).eq('id', barberId);
    expect(await offeredSlot('12:00', { barberId })).not.toBeNull();
  });
});
