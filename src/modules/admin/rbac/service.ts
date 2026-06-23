import { supabase } from '../../../lib/supabase';

export class AdminService {
  static async listStaffUsers() {
    const { data, error } = await supabase
      .from('staff_users')
      .select(`
        id, full_name, email, phone, is_active, created_at,
        staff_user_roles(
          branch_id,
          roles( id, name ),
          branches( id, name )
        )
      `)
      .is('deleted_at', null)
      .order('full_name', { ascending: true });
    if (error) throw new Error('Gagal mengambil daftar staff: ' + error.message);
    return data;
  }

  static async getStaffRoles(staffUserId: string) {
    const { data, error } = await supabase
      .from('staff_user_roles')
      .select('id, branch_id, roles(id, name), branches(id, name)')
      .eq('staff_user_id', staffUserId);
    if (error) throw new Error('Gagal mengambil role staff: ' + error.message);
    return data;
  }

  static async getRoles() {
    const { data: roles, error } = await supabase.from('roles').select('*');
    if (error) throw new Error('Gagal mengambil daftar roles');
    return roles;
  }

  static async createRole(name: string) {
    const { data: role, error } = await supabase
      .from('roles')
      .insert({ name })
      .select()
      .single();

    if (error) throw new Error('Gagal membuat role, pastikan nama unik');
    return role;
  }

  static async getPermissions() {
    const { data: permissions, error } = await supabase.from('permissions').select('*');
    if (error) throw new Error('Gagal mengambil daftar permissions');
    return permissions;
  }

  static async assignRole(staffUserId: string, roleId: string, branchId?: string | null) {
    const { data, error } = await supabase
      .from('staff_user_roles')
      .insert({
        staff_user_id: staffUserId,
        role_id: roleId,
        branch_id: branchId || null
      })
      .select()
      .single();

    if (error) throw new Error('Gagal memasangkan role pada staff');
    return data;
  }

  static async revokeRole(staffUserId: string, roleId: string) {
    const { error } = await supabase
      .from('staff_user_roles')
      .delete()
      .match({ staff_user_id: staffUserId, role_id: roleId });

    if (error) throw new Error('Gagal mencabut role dari staff');
    return true;
  }
}
