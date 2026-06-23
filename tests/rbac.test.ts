import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { app } from '../src/app';
import { supabase } from '../src/lib/supabase';
import * as argon2 from 'argon2';

const API_PREFIX = '/api/v1';

describe('RBAC Module', () => {
  let superAdminToken = '';
  let branchAdminToken = '';
  let barberToken = '';
  let noPermsToken = '';

  let superAdminId = '';
  let branchAdminId = '';
  let barberId = '';
  let noPermsId = '';
  
  let branchAId = '';
  let branchBId = '';
  
  let roleSuperAdminId = '';
  let roleBranchAdminId = '';
  let permissionManageStaffId = '';

  const password = 'Password123!';
  let pwHash = '';

  beforeAll(async () => {
    pwHash = await argon2.hash(password);
    
    // 1. Get or Create Roles & Permissions
    const { data: roles } = await supabase.from('roles').select('*');
    roleSuperAdminId = roles?.find(r => r.name === 'super_admin')?.id || '';
    roleBranchAdminId = roles?.find(r => r.name === 'branch_admin')?.id || '';

    const { data: perms } = await supabase.from('permissions').select('*');
    permissionManageStaffId = perms?.find(p => p.code === 'manage_staff')?.id || '';

    // Assign manage_staff to super_admin and branch_admin if not exists
    // We try to insert and ignore error if it exists
    await supabase.from('role_permissions').insert([
      { role_id: roleSuperAdminId, permission_id: permissionManageStaffId },
      { role_id: roleBranchAdminId, permission_id: permissionManageStaffId }
    ]);

    // 2. Create Branches
    const { data: bA } = await supabase.from('branches').insert({ name: 'Branch A', region_id: null }).select('id').single();
    const { data: bB } = await supabase.from('branches').insert({ name: 'Branch B', region_id: null }).select('id').single();
    if(bA) branchAId = bA.id;
    if(bB) branchBId = bB.id;

    // 3. Create Staff Users
    const { data: sa } = await supabase.from('staff_users').insert({ full_name: 'Super Admin', email: 'sa@test.com', password_hash: pwHash }).select('id').single();
    const { data: ba } = await supabase.from('staff_users').insert({ full_name: 'Branch Admin', email: 'ba@test.com', password_hash: pwHash }).select('id').single();
    const { data: bb } = await supabase.from('staff_users').insert({ full_name: 'Barber', email: 'barber@test.com', password_hash: pwHash }).select('id').single();
    const { data: np } = await supabase.from('staff_users').insert({ full_name: 'No Perms', email: 'noperms@test.com', password_hash: pwHash }).select('id').single();

    if(sa) superAdminId = sa.id;
    if(ba) branchAdminId = ba.id;
    if(bb) barberId = bb.id;
    if(np) noPermsId = np.id;

    // 4. Assign Roles
    // Super admin -> global (branch_id: null)
    await supabase.from('staff_user_roles').insert({ staff_user_id: superAdminId, role_id: roleSuperAdminId, branch_id: null });
    // Branch admin -> Branch A
    await supabase.from('staff_user_roles').insert({ staff_user_id: branchAdminId, role_id: roleBranchAdminId, branch_id: branchAId });
    // Barber -> Branch A
    await supabase.from('barbers').insert({ staff_user_id: barberId, branch_id: branchAId, display_name: 'Barber A' });

    // 5. Login to get tokens
    const login = async (email: string) => {
      const res = await app.handle(new Request(`http://localhost${API_PREFIX}/staff/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      }));
      const body = await res.json();
      return body.data.accessToken;
    };

    superAdminToken = await login('sa@test.com');
    branchAdminToken = await login('ba@test.com');
    barberToken = await login('barber@test.com');
    noPermsToken = await login('noperms@test.com');
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('staff_user_roles').delete().in('staff_user_id', [superAdminId, branchAdminId]);
    await supabase.from('barbers').delete().eq('staff_user_id', barberId);
    await supabase.from('staff_users').delete().in('id', [superAdminId, branchAdminId, barberId, noPermsId]);
    await supabase.from('branches').delete().in('id', [branchAId, branchBId]);
    // cleanup role permissions that were added
    await supabase.from('role_permissions').delete().match({ role_id: roleSuperAdminId, permission_id: permissionManageStaffId });
    await supabase.from('role_permissions').delete().match({ role_id: roleBranchAdminId, permission_id: permissionManageStaffId });
  });

  it('1. Super Admin bisa akses rute admin global', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/roles`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    }));
    expect(res.status).toBe(200);
  });

  it('2. Staff tanpa permission mendapat 403', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/roles`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${noPermsToken}` }
    }));
    expect(res.status).toBe(403);
  });

  it('3. Branch Admin bisa akses cabang A', async () => {
    const { requireBranchScope } = await import('../src/middleware/rbac');
    const handler = requireBranchScope((c: any) => c.headers['x-branch-id']);
    
    const ctx = {
      staffId: branchAdminId,
      headers: { 'x-branch-id': branchAId },
      set: { status: 200 }
    };
    
    await handler(ctx);
    expect(ctx.set.status).toBe(200);
  });

  it('4. Branch Admin tidak bisa akses cabang B', async () => {
    const { requireBranchScope } = await import('../src/middleware/rbac');
    const handler = requireBranchScope((c: any) => c.headers['x-branch-id']);
    
    const ctx = {
      staffId: branchAdminId,
      headers: { 'x-branch-id': branchBId },
      set: { status: 200 }
    };
    
    await handler(ctx);
    expect(ctx.set.status).toBe(403);
  });

  it('5. Super Admin bisa akses cabang B', async () => {
    const { requireBranchScope } = await import('../src/middleware/rbac');
    const handler = requireBranchScope((c: any) => c.headers['x-branch-id']);
    
    const ctx = {
      staffId: superAdminId,
      headers: { 'x-branch-id': branchBId },
      set: { status: 200 }
    };
    
    await handler(ctx);
    expect(ctx.set.status).toBe(200);
  });

  it('6. Unauthenticated access tanpa token sama sekali ditolak (401)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/roles`, {
      method: 'GET'
    }));
    expect(res.status).toBe(401);
  });

  it('7. Akses dengan token ngawur (malformed) ditolak (401)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/roles`, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ngawur123' }
    }));
    expect(res.status).toBe(401);
  });

  it('8. Barber (tidak punya manage_staff) mencoba akses admin route ditolak (403)', async () => {
    const res = await app.handle(new Request(`http://localhost${API_PREFIX}/hq/roles`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${barberToken}` }
    }));
    expect(res.status).toBe(403);
  });

  it('9. Branch Admin mencoba akses cabang antah berantah (fake UUID) ditolak (403)', async () => {
    const { requireBranchScope } = await import('../src/middleware/rbac');
    const handler = requireBranchScope((c: any) => c.headers['x-branch-id']);
    
    const ctx = {
      staffId: branchAdminId,
      headers: { 'x-branch-id': '00000000-0000-0000-0000-000000000000' }, // Fake UUID
      set: { status: 200 }
    };
    
    await handler(ctx);
    expect(ctx.set.status).toBe(403);
  });

  it('10. Middleware requirePermission dengan kode permission yang salah/tidak ada ditolak (403)', async () => {
    const { requirePermission } = await import('../src/middleware/rbac');
    const handler = requirePermission('permission_invalid_123');
    
    const ctx = {
      staffId: superAdminId, // Super admin pun jika dicek permission bodong harusnya 403
      set: { status: 200 }
    };
    
    await handler(ctx);
    expect(ctx.set.status).toBe(403);
  });
});
