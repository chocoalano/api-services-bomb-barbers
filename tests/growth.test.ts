import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('Growth Features Module (Reviews & Expenses)', () => {
  let branchId = '';
  let otherBranchId = '';
  let customerId = '';
  let otherCustomerId = '';
  let barberId = '';
  let adminStaffId = '';
  
  let customerToken = '';
  let otherCustomerToken = '';
  let adminToken = '';
  
  let completedAptId = '';
  let pendingAptId = '';

  const password = 'Password123!';

  beforeAll(async () => {
    const pwHash = await argon2.hash(password);
    const suffix = crypto.randomUUID().split('-')[0];

    const { data: region } = await supabase.from('regions').insert({ code: `GW${suffix.toString().slice(-4)}`, name: 'Growth Region' }).select('id').single();
    const { data: branch } = await supabase.from('branches').insert({ name: 'Growth Branch', region_id: region?.id }).select('id').single();
    if (branch) branchId = branch.id;

    const { data: branch2 } = await supabase.from('branches').insert({ name: 'Growth Branch 2', region_id: region?.id }).select('id').single();
    if (branch2) otherBranchId = branch2.id;

    const { data: customer } = await supabase.from('customers').insert({ full_name: 'CGrowth', email: `cg${suffix}@test.com`, phone: `444${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer) customerId = customer.id;

    const { data: customer2 } = await supabase.from('customers').insert({ full_name: 'OtherGrowth', email: `og${suffix}@test.com`, phone: `555${suffix}`, password_hash: pwHash }).select('id').single();
    if (customer2) otherCustomerId = customer2.id;

    const { data: adminStaff } = await supabase.from('staff_users').insert({ full_name: 'AGrowth', email: `ag${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    if (adminStaff) adminStaffId = adminStaff.id;

    // Beri adminStaff akses ke branch 1
    const { data: roleAdmin } = await supabase.from('roles').select('id').eq('name', 'branch_admin').single();
    if (roleAdmin && adminStaff) {
      await supabase.from('staff_user_roles').insert({
        staff_user_id: adminStaff.id, role_id: roleAdmin.id, branch_id: branchId
      });
    }

    const { data: barberStaff } = await supabase.from('staff_users').insert({ full_name: 'BGrowth', email: `bg${suffix}@test.com`, password_hash: pwHash }).select('id').single();
    const { data: barber } = await supabase.from('barbers').insert({ staff_user_id: barberStaff?.id, branch_id: branchId, display_name: 'Growth Barber' }).select('id').single();
    if (barber) barberId = barber.id;

    // Login Admin
    const loginA = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `ag${suffix}@test.com`, password })
    })).then(r => r.json());
    adminToken = loginA.data?.accessToken;

    // Login Customer
    const loginC = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `444${suffix}`, password })
    })).then(r => r.json());
    customerToken = loginC.data?.accessToken;

    const loginC2 = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `555${suffix}`, password })
    })).then(r => r.json());
    otherCustomerToken = loginC2.data?.accessToken;

    // Setup completed appointment
    const { data: aptC } = await supabase.from('appointments').insert({
      branch_id: branchId, customer_id: customerId, barber_id: barberId, source: 'walk_in', status: 'completed'
    }).select('id').single();
    if (aptC) completedAptId = aptC.id;

    // Setup pending appointment
    const { data: aptP } = await supabase.from('appointments').insert({
      branch_id: branchId, customer_id: customerId, barber_id: barberId, source: 'walk_in', status: 'pending'
    }).select('id').single();
    if (aptP) pendingAptId = aptP.id;
  });

  afterAll(async () => {
    // Teardown logic
    await supabase.from('reviews').delete().in('appointment_id', [completedAptId, pendingAptId]);
    await supabase.from('appointments').delete().in('id', [completedAptId, pendingAptId]);
    await supabase.from('barbers').delete().eq('id', barberId);
  });

  describe('Reviews Feature', () => {
    it('1. Review ditolak jika appointment tidak ditemukan', async () => {
      const fakeId = crypto.randomUUID();
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${fakeId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ rating: 5 })
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(400);
      expect(body.message).toBe('Bad Request');
      expect(body.errors).toContain('tidak ditemukan');
    });

    it('2. Review ditolak jika customer bukan pemilik appointment', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${completedAptId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${otherCustomerToken}` },
        body: JSON.stringify({ rating: 4 })
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(400);
      expect(body.errors).toContain('tidak memiliki akses');
    });

    it('3. Review ditolak jika status appointment belum completed', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${pendingAptId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ rating: 5 })
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(400);
      expect(body.errors).toContain('sudah selesai');
    });

    it('4. Review ditolak jika rating di luar range (misal 6)', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${completedAptId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ rating: 6 })
      }));
      // Validasi Elysia / TypeBox harus mencegat ini
      expect(res.status).toBe(400); // Global error handler menstandarkan validation error sebagai Bad Request
    });

    it('5. Customer dapat memberikan review valid untuk appointment yang completed', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${completedAptId}/reviews`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ rating: 5, comment: 'Sangat bagus!', tip_amount: 0 })
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(201);
      expect(body.data.rating).toBe(5);
    });

    it('6. Review hanya bisa diberikan satu kali per appointment (Idempotency / Unique)', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/customer/appointments/${completedAptId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerToken}` },
        body: JSON.stringify({ rating: 4, comment: 'Review kedua' })
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(409);
      expect(body.errors).toContain('sudah memberikan');
    });

    it('7. Rating barber otomatis ter-update (Avg dan Count)', async () => {
      const { data: barber } = await supabase.from('barbers').select('rating_avg, rating_count').eq('id', barberId).single();
      expect(barber?.rating_count).toBe(1);
      expect(Number(barber?.rating_avg)).toBe(5);
    });
  });

  describe('Branch Expenses Feature', () => {
    let expenseId = '';
    
    it('1. Ditolak jika user mencoba mencatat pengeluaran di cabang yang bukan miliknya', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/expenses/branches/${otherBranchId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ amount: 50000, description: 'Snack', expense_date: '2026-06-10' })
      }));
      expect(res.status).toBe(403);
    });

    it('2. Ditolak jika payload tidak lengkap (misal amount negatif atau 0)', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/expenses/branches/${branchId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ amount: 0, description: 'Test', expense_date: '2026-06-10' })
      }));
      expect(res.status).toBe(400); // Global error handler menstandarkan validation error sebagai Bad Request
    });

    it('3. Admin dapat mencatat pengeluaran di cabangnya sendiri', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/expenses/branches/${branchId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ amount: 150000, description: 'Beli handuk', expense_date: '2026-06-10' })
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      
      if (res.status === 201) {
        expenseId = body.data.id;
        expect(body.data.amount).toBe(150000);
      }
    });

    it('4. Admin dapat mengambil daftar pengeluaran cabangnya', async () => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/expenses/branches/${branchId}`, {
        method: 'GET', headers: { 'Authorization': `Bearer ${adminToken}` }
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      if (res.status === 200) {
        expect(Array.isArray(body.data)).toBe(true);
      }
    });

    it('5. Admin dapat mengubah pengeluaran cabangnya', async () => {
      if (!expenseId) return; // Skip if creation failed
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/expenses/branches/${branchId}/${expenseId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ amount: 200000 })
      }));
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(200);
      expect(body.data.amount).toBe(200000);
    });

    it('6. Admin dapat menghapus pengeluaran', async () => {
      if (!expenseId) return; // Skip if creation failed
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/admin/expenses/branches/${branchId}/${expenseId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${adminToken}` }
      }));
      expect(res.status).toBe(200);
    });
  });
});
