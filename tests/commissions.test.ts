import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Commission & Revenue Share Module', () => {
  let regionId = '';
  let branchId = '';
  let customerId = '';
  let barberId = '';
  let barberStaffId = '';
  let adminId = '';
  let serviceId = '';
  let aptId = '';
  let apt2Id = '';
  let apt3Id = '';
  let paymentId = '';
  let adminToken = '';
  let branchAdminRoleId = '';

  let ruleGlobalId = '';
  let ruleRegionId = '';
  let ruleBranchId = '';
  let ruleServiceId = '';
  let ruleBarberId = '';

  const password = 'Password123!';

  beforeAll(async () => {
    const pwHash = await argon2.hash(password);
    const suffix = crypto.randomUUID().split('-')[0];

    // 1. Master Data
    const { data: region } = await supabase.from('regions').insert({ code: `RC${suffix.toString().slice(-4)}`, name: 'Comm Region' }).select('id').single();
    if (region) regionId = region.id;

    const { data: branch } = await supabase.from('branches').insert({ name: 'Comm Branch', region_id: regionId }).select('id').single();
    if (branch) branchId = branch.id;

    const { data: customer } = await supabase.from('customers').insert({ full_name: 'CComm', email: `cc${suffix}@test.com`, phone: `555${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer) customerId = customer.id;

    const { data: barber } = await supabase.from('staff_users').insert({ full_name: 'BComm', email: `bc${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    let staffUserId = barber?.id || '';
    barberStaffId = staffUserId;
    const { data: bData, error: bErr } = await supabase.from('barbers').insert({ staff_user_id: staffUserId, branch_id: branchId, display_name: 'Barber Comm' }).select('id').single();
    if (bErr) throw new Error('Barber Insert Error: ' + bErr.message);
    barberId = bData.id;

    const { data: admin } = await supabase.from('staff_users').insert({ full_name: 'AComm', email: `ac${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    if (admin) adminId = admin.id;
    const { data: branchAdminRole } = await supabase
      .from('roles')
      .select('id')
      .eq('name', 'branch_admin')
      .single();
    if (!branchAdminRole || !adminId) {
      throw new Error('Role branch_admin atau admin test tidak tersedia');
    }
    branchAdminRoleId = branchAdminRole.id;
    const { error: roleAssignmentError } = await supabase
      .from('staff_user_roles')
      .insert({
        staff_user_id: adminId,
        role_id: branchAdminRoleId,
        branch_id: branchId
      });
    if (roleAssignmentError) {
      throw new Error(`Gagal memberikan scope cabang pada admin test: ${roleAssignmentError.message}`);
    }

    const { data: svc } = await supabase.from('services').insert({ name: 'CommCut', default_duration_min: 30 }).select('id').single();
    if (svc) serviceId = svc.id;

    // Login
    const loginA = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `ac${suffix}@test.com`, password })
    })).then(r => r.json());
    adminToken = loginA.data.accessToken;

    // 2. Setup 5 Rules with different configurations to test priority
    const now = new Date().toISOString();
    
    // Global: 10/10/80
    const { data: r1 } = await supabase.from('commission_rules').insert({ scope: 'global', barber_pct: 10, branch_pct: 10, hq_pct: 80, effective_from: now, tip_to_barber: true }).select('id').single();
    if (r1) ruleGlobalId = r1.id;

    // Region: 20/20/60
    const { data: r2 } = await supabase.from('commission_rules').insert({ scope: 'region', scope_ref_id: regionId, barber_pct: 20, branch_pct: 20, hq_pct: 60, effective_from: now, tip_to_barber: true }).select('id').single();
    if (r2) ruleRegionId = r2.id;

    // Branch: 30/30/40
    const { data: r3 } = await supabase.from('commission_rules').insert({ scope: 'branch', scope_ref_id: branchId, barber_pct: 30, branch_pct: 30, hq_pct: 40, effective_from: now, tip_to_barber: true }).select('id').single();
    if (r3) ruleBranchId = r3.id;

    // Service: 40/40/20
    const { data: r4 } = await supabase.from('commission_rules').insert({ scope: 'service', scope_ref_id: serviceId, barber_pct: 40, branch_pct: 40, hq_pct: 20, effective_from: now, tip_to_barber: true }).select('id').single();
    if (r4) ruleServiceId = r4.id;

    // Barber: 50/30/20 (50% barber)
    const { data: r5 } = await supabase.from('commission_rules').insert({ scope: 'barber', scope_ref_id: barberId, barber_pct: 50, branch_pct: 30, hq_pct: 20, effective_from: now, tip_to_barber: true }).select('id').single();
    if (r5) ruleBarberId = r5.id;

    // 3. Setup Appointment
    const { data: apt, error: aptErr } = await supabase.from('appointments').insert({
      branch_id: branchId, customer_id: customerId, barber_id: barberId, source: 'walk_in', status: 'completed'
    }).select('id').single();
    if (aptErr) throw new Error('Apt Error: ' + aptErr.message);
    if (apt) aptId = apt.id;

    await supabase.from('appointment_services').insert({ appointment_id: aptId, service_id: serviceId, price_amount: 100000, duration_min: 30 });

    const { data: pay, error: pErr } = await supabase.from('payments').insert({
      appointment_id: aptId, branch_id: branchId, service_amount: 100000, product_amount: 0, discount_amount: 0, tip_amount: 15000, total_amount: 115000, method: 'cash', status: 'paid', paid_at: now
    }).select('id').single();
    if (pErr) throw new Error('Payment Insert Error: ' + pErr.message);
    paymentId = pay.id;
  });

  afterAll(async () => {
    const appointmentIds = [aptId, apt2Id, apt3Id].filter(Boolean);
    await supabase.from('commission_entries').delete().in('appointment_id', appointmentIds);
    await supabase.from('commission_rules').delete().in('id', [ruleGlobalId, ruleRegionId, ruleBranchId, ruleServiceId, ruleBarberId]);
    await supabase.from('payments').delete().in('appointment_id', appointmentIds);
    await supabase.from('appointment_services').delete().in('appointment_id', appointmentIds);
    await supabase.from('appointments').delete().in('id', appointmentIds);
    await supabase.from('staff_user_roles').delete().eq('staff_user_id', adminId);
    await supabase.from('services').delete().eq('id', serviceId);
    await supabase.from('barbers').delete().eq('id', barberId);
    await supabase.from('staff_users').delete().in('id', [barberStaffId, adminId]);
    await supabase.from('customers').delete().eq('id', customerId);
    await supabase.from('branches').delete().eq('id', branchId);
    await supabase.from('regions').delete().eq('id', regionId);
  });

  it('1. Resolusi rule harus memilih rule barber mengalahkan yang lain (Prioritas 5)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${aptId}/calculate-commission`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }));
    const body = await res.json();
    
    expect(res.status).toBe(201);
    expect(body.data.commission_rule_id).toBe(ruleBarberId); // Rule Barber menang
    
    // Test base_amount split & tip_to_barber
    // Base: 100,000. Barber pct: 50% = 50,000. Branch pct: 30% = 30,000. HQ pct: 20% = 20,000.
    // Tip: 15,000 (100% ke barber karena tip_to_barber true).
    // Barber share total = 50,000 + 15,000 = 65,000
    expect(body.data.base_amount).toBe(100000);
    expect(body.data.barber_share).toBe(65000);
    expect(body.data.branch_share).toBe(30000);
    expect(body.data.hq_share).toBe(20000);
    expect(body.data.tip_amount).toBe(15000);
  });

  it('2. Total split selalu sama persis dengan base_amount + tip', async () => {
    const { data: comm } = await supabase.from('commission_entries').select('*').eq('appointment_id', aptId).single();
    expect(comm).toBeDefined();
    if (comm) {
      const totalShares = Number(comm.barber_share) + Number(comm.branch_share) + Number(comm.hq_share);
      const expectedTotal = Number(comm.base_amount) + Number(comm.tip_amount);
      expect(totalShares).toBe(expectedTotal);
    }
  });

  it('3. Idempotency mencegah komisi dobel pada appointment yang sama', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${aptId}/calculate-commission`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }));
    const body = await res.json();
    
    expect(res.status).toBe(409); // Conflict
    expect(body.message).toContain('Idempotency');
  });

  it('4. Mengambil detail komisi (Read) via endpoint admin', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${aptId}/commission`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    }));
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.data.appointment_id).toBe(aptId);
    expect(body.data.barber_share).toBe(65000);
  });

  it('5. Skenario Multi-Servis dihitung terpisah', async () => {
    // Setup apt2 with 2 services (100k and 50k)
    const { data: apt2 } = await supabase.from('appointments').insert({ branch_id: branchId, customer_id: customerId, barber_id: barberId, source: 'walk_in', status: 'completed' }).select('id').single();
    apt2Id = apt2!.id;
    await supabase.from('appointment_services').insert([
      { appointment_id: apt2!.id, service_id: serviceId, price_amount: 100000, duration_min: 30 },
      { appointment_id: apt2!.id, service_id: serviceId, price_amount: 50000, duration_min: 15 }
    ]);
    await supabase.from('payments').insert({ appointment_id: apt2!.id, branch_id: branchId, service_amount: 150000, product_amount: 0, discount_amount: 0, tip_amount: 0, total_amount: 150000, method: 'cash', status: 'paid', paid_at: new Date().toISOString() });

    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${apt2!.id}/calculate-commission`, { method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` } }));
    const body = await res.json();
    
    expect(res.status).toBe(201);
    expect(body.data.base_amount).toBe(150000);
    // Base 1: 100k -> 50k barber, 30k branch, 20k hq (Rule Barber priority 5)
    // Base 2: 50k -> 25k barber, 15k branch, 10k hq
    // Total barber = 75k
    expect(body.data.barber_share).toBe(75000);
    expect(body.data.branch_share).toBe(45000);
    expect(body.data.hq_share).toBe(30000);
  });

  it('6. Skenario Servis Gratis (Rp 0) namun ada Tip, mencegah Infinity Error', async () => {
    const { data: apt3 } = await supabase.from('appointments').insert({ branch_id: branchId, customer_id: customerId, barber_id: barberId, source: 'walk_in', status: 'completed' }).select('id').single();
    apt3Id = apt3!.id;
    await supabase.from('appointment_services').insert({ appointment_id: apt3!.id, service_id: serviceId, price_amount: 0, duration_min: 30 });
    // Rp 0 base, Tip 50000
    await supabase.from('payments').insert({ appointment_id: apt3!.id, branch_id: branchId, service_amount: 0, product_amount: 0, discount_amount: 0, tip_amount: 50000, total_amount: 50000, method: 'cash', status: 'paid', paid_at: new Date().toISOString() });

    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/appointments/${apt3!.id}/calculate-commission`, { method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` } }));
    const body = await res.json();
    
    expect(res.status).toBe(201);
    expect(body.data.base_amount).toBe(0);
    expect(body.data.tip_amount).toBe(50000);
    // Tip_to_barber is true in the rule, so 50k goes to barber
    expect(body.data.barber_share).toBe(50000);
    expect(body.data.branch_share).toBe(0);
    expect(body.data.hq_share).toBe(0);
  });
});
