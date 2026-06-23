import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import { redis } from '../src/lib/redis';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Dashboard Module (Fase 1)', () => {
  let regionId = '';
  let branchId = '';
  let otherBranchId = '';
  let customerId = '';
  let barber1Id = '';
  let barber2Id = '';
  let adminId = '';
  let hqId = '';

  let adminToken = '';
  let barber1Token = '';
  let barber2Token = '';
  let hqToken = '';

  const password = 'Password123!';

  beforeAll(async () => {
    const pwHash = await argon2.hash(password);
    const suffix = crypto.randomUUID().split('-')[0];

    // 1. Setup Master
    const { data: region } = await supabase.from('regions').insert({ code: `RD${suffix.toString().slice(-4)}`, name: 'Dash Region' }).select('id').single();
    if (region) regionId = region.id;

    const { data: b1 } = await supabase.from('branches').insert({ name: 'Dash Branch 1', region_id: regionId, address: 'Jl. Dashboard Barber No. 1' }).select('id').single();
    if (b1) branchId = b1.id;

    const { data: b2 } = await supabase.from('branches').insert({ name: 'Dash Branch 2', region_id: regionId }).select('id').single();
    if (b2) otherBranchId = b2.id;

    const { data: customer } = await supabase.from('customers').insert({ full_name: 'CDash', email: `cd${suffix}@test.com`, phone: `555D${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer) customerId = customer.id;

    // Ensure roles exist
    const getRole = async (name: string) => {
      let { data } = await supabase.from('roles').select('id').eq('name', name).single();
      if (!data) {
        const { data: ins, error } = await supabase.from('roles').insert({ name }).select('id').single();
        if (error) throw new Error('Role error: ' + error.message);
        data = ins;
      }
      return data;
    };
    const roleAdmin = await getRole('branch_admin');
    const roleHQ = await getRole('super_admin');
    const roleBarber = await getRole('barber');

    // Admin Cabang
    const { data: admin } = await supabase.from('staff_users').insert({ full_name: 'ADash', email: `ad${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    if (admin) adminId = admin.id;
    await supabase.from('staff_user_roles').insert({ staff_user_id: adminId, role_id: roleAdmin!.id, branch_id: branchId });

    // Super Admin
    const { data: hq } = await supabase.from('staff_users').insert({ full_name: 'HQDash', email: `hq${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    if (hq) hqId = hq.id;
    await supabase.from('staff_user_roles').insert({ staff_user_id: hqId, role_id: roleHQ!.id });

    // Barbers
    const { data: barb1, error: e1 } = await supabase.from('staff_users').insert({ full_name: 'B1Dash', email: `b1${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    if (e1) throw new Error(e1.message);
    const { data: realB1 } = await supabase.from('barbers').insert({ staff_user_id: barb1!.id, branch_id: branchId, display_name: 'Barber 1' }).select('id').single();
    barber1Id = realB1!.id;
    await supabase.from('staff_user_roles').insert({ staff_user_id: barb1!.id, role_id: roleBarber!.id, branch_id: branchId });

    const { data: barb2 } = await supabase.from('staff_users').insert({ full_name: 'B2Dash', email: `b2${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    const { data: realB2 } = await supabase.from('barbers').insert({ staff_user_id: barb2!.id, branch_id: branchId, display_name: 'Barber 2' }).select('id').single();
    barber2Id = realB2!.id;
    await supabase.from('staff_user_roles').insert({ staff_user_id: barb2!.id, role_id: roleBarber!.id, branch_id: branchId });

    // Login
    const loginA = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `ad${suffix}@test.com`, password }) })).then(r => r.json());
    adminToken = loginA.data.accessToken;

    const loginHQ = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `hq${suffix}@test.com`, password }) })).then(r => r.json());
    hqToken = loginHQ.data.accessToken;

    const loginB1 = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `b1${suffix}@test.com`, password }) })).then(r => r.json());
    barber1Token = loginB1.data.accessToken;

    const loginB2 = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `b2${suffix}@test.com`, password }) })).then(r => r.json());
    barber2Token = loginB2.data.accessToken;

    // 2. Transaksi Hari Ini
    const { data: rule } = await supabase.from('commission_rules').insert({ scope: 'global', barber_pct: 50, branch_pct: 30, hq_pct: 20, effective_from: new Date().toISOString() }).select('id').single();

    // Barber 1 (Selesai & Lunas)
    const { data: apt1 } = await supabase.from('appointments').insert({ branch_id: branchId, customer_id: customerId, barber_id: barber1Id, source: 'walk_in', status: 'completed' }).select('id').single();
    await supabase.from('payments').insert({ appointment_id: apt1!.id, branch_id: branchId, service_amount: 100000, product_amount: 0, discount_amount: 0, tip_amount: 10000, total_amount: 110000, method: 'cash', status: 'paid', paid_at: new Date().toISOString() });
    await supabase.from('commission_entries').insert({ appointment_id: apt1!.id, commission_rule_id: rule!.id, base_amount: 100000, barber_share: 60000, branch_share: 30000, hq_share: 20000, tip_amount: 10000, calculated_at: new Date().toISOString() });

    // Barber 2 (Batal)
    await supabase.from('appointments').insert({ branch_id: branchId, customer_id: customerId, barber_id: barber2Id, source: 'online_booking', status: 'cancelled' });
  });

  it('1. Admin Cabang bisa melihat ringkasan cabangnya (revenue dan komisi terakumulasi dengan benar)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${branchId}/dashboard/today`, { headers: { 'Authorization': `Bearer ${adminToken}` } }));
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.data.total_appointments).toBe(2);
    expect(body.data.total_completed).toBe(1);
    expect(body.data.revenue.total).toBe(110000);
    expect(body.data.shares.barber).toBe(60000); // 50k base + 10k tip
    expect(body.data.shares.branch).toBe(30000);
  });

  it('2. Admin Cabang dilarang melihat dashboard cabang lain', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${otherBranchId}/dashboard/today`, { headers: { 'Authorization': `Bearer ${adminToken}` } }));
    expect(res.status).toBe(403);
  });

  it('3. Barber hanya bisa melihat kinerjanya sendiri dan dilarang mengintip yang lain', async () => {
    const resB1 = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/dashboard/today`, { headers: { 'Authorization': `Bearer ${barber1Token}` } }));
    const body1 = await resB1.json();
    
    expect(resB1.status).toBe(200);
    expect(body1.data.pending_orders).toBe(0);
    expect(body1.data.active_orders).toBe(0);
    expect(body1.data.completed_today).toBe(1);
    expect(body1.data.rating).toBe(0);
    expect(body1.data.total_completed).toBe(1);
    expect(body1.data.total_earnings).toBe(60000); // Hanya miliknya

    const resB2 = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/dashboard/today`, { headers: { 'Authorization': `Bearer ${barber2Token}` } }));
    const body2 = await resB2.json();
    
    expect(resB2.status).toBe(200);
    expect(body2.data.total_completed).toBe(0); // Batal
    expect(body2.data.total_earnings).toBe(0);
  });

  it('3b. Staff me mengembalikan field ringkas untuk Dashboard Barber', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/me`, {
      headers: { 'Authorization': `Bearer ${barber1Token}` }
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe('Barber 1');
    expect(body.data.branch_area).toBe('Dash Branch 1');
    expect(body.data.radius_km).toBe(5);
    expect(body.data.rating_avg).toBe(0);
    expect(body.data.rating_count).toBe(0);
    expect(body.data.barber.id).toBe(barber1Id);
  });

  it('3c. Barber queue mengembalikan order siap pakai untuk frontend dashboard', async () => {
    const { data: svc } = await supabase
      .from('services')
      .insert({ name: 'Classic Cut + Hair Wash', default_duration_min: 45 })
      .select('id')
      .single();

    const { data: apt } = await supabase.from('appointments').insert({
      branch_id: branchId,
      customer_id: customerId,
      barber_id: barber1Id,
      source: 'online_booking',
      status: 'pending',
      scheduled_at: new Date().toISOString()
    }).select('id').single();

    await supabase.from('appointment_services').insert({
      appointment_id: apt!.id,
      service_id: svc!.id,
      price_amount: 85000,
      duration_min: 45
    });

    await redis.set(`tracking:${apt!.id}:route`, JSON.stringify({
      eta_minutes: 15,
      distance_km: 1.8
    }), 'EX', 60);

    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/queue`, {
      headers: { 'Authorization': `Bearer ${barber1Token}` }
    }));
    const body = await res.json();
    const order = body.data.find((item: any) => item.id === apt!.id);

    expect(res.status).toBe(200);
    expect(order.customer_name).toBe('CDash');
    expect(order.service_name).toBe('Classic Cut + Hair Wash');
    expect(order.price).toBe(85000);
    expect(order.distance).toBe('1.8 km');
    expect(order.eta).toBe('15 menit');
    expect(order.address).toBe('Jl. Dashboard Barber No. 1');
    expect(order.status).toBe('pending');
    expect(order.raw_status).toBe('pending');

    const dashboardRes = await app.handle(new Request(`http://localhost${API_PREFIX}/barber/dashboard/today`, {
      headers: { 'Authorization': `Bearer ${barber1Token}` }
    }));
    const dashboardBody = await dashboardRes.json();

    expect(dashboardRes.status).toBe(200);
    expect(dashboardBody.data.current_order.id).toBe(apt!.id);
    expect(dashboardBody.data.current_order.status).toBe('pending');

    const staffQueueRes = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/queue`, {
      headers: { 'Authorization': `Bearer ${barber1Token}` }
    }));
    const staffQueueBody = await staffQueueRes.json();
    const staffQueueOrder = staffQueueBody.data.find((item: any) => item.id === apt!.id);

    expect(staffQueueRes.status).toBe(200);
    expect(staffQueueOrder.status).toBe('pending');

    const staffDashboardRes = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/dashboard/today`, {
      headers: { 'Authorization': `Bearer ${barber1Token}` }
    }));
    const staffDashboardBody = await staffDashboardRes.json();

    expect(staffDashboardRes.status).toBe(200);
    expect(staffDashboardBody.data.current_order.id).toBe(apt!.id);
  });

  it('4. Super Admin (HQ) bisa melihat ringkasan seluruh operasi', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/dashboard/today`, { headers: { 'Authorization': `Bearer ${hqToken}` } }));
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.data.total_completed).toBeGreaterThanOrEqual(1); // minimal 1 dari tes di atas
    expect(body.data.revenue.total).toBeGreaterThanOrEqual(110000);
  });

  it('5. Perlindungan Null Safety: Cabang tanpa transaksi hari ini mengembalikan angka 0 tanpa error', async () => {
    // Create an empty branch
    const { data: b3 } = await supabase.from('branches').insert({ name: 'Dash Branch Empty', region_id: regionId }).select('id').single();
    const { data: admin3 } = await supabase.from('staff_users').insert({ full_name: 'A3Dash', email: `a3${Date.now()}@test.com`, password_hash: 'pw' }).select('id').single();
    const { data: roleAdmin } = await supabase.from('roles').select('id').eq('name', 'branch_admin').single();
    await supabase.from('staff_user_roles').insert({ staff_user_id: admin3!.id, role_id: roleAdmin!.id, branch_id: b3!.id });
    
    // Note: the test login uses argon2 password "Password123!" but admin3 has 'pw' hash which is invalid. We will just use HQ token to view empty branch.
    // Wait, the test uses global staff role? No, let's just use HQ token to view empty branch.
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/branches/${b3!.id}/dashboard/today`, { headers: { 'Authorization': `Bearer ${hqToken}` } }));
    const body = await res.json();
    
    // Actually HQ Token doesn't pass requireBranchScope because it expects branch_admin token OR global token. Wait, requireBranchScope checks global token and passes!
    expect(res.status).toBe(200);
    expect(body.data.total_appointments).toBe(0);
    expect(body.data.revenue.total).toBe(0);
    expect(body.data.shares.barber).toBe(0);
  });
});
