import { supabase } from '../../../lib/supabase';

export class AdminCatalogService {
  // Branches
  static async createBranch(data: any) {
    const { data: branch, error } = await supabase.from('branches').insert(data).select().single();
    if (error) throw new Error(error.message);
    return branch;
  }
  static async updateBranch(id: string, data: any) {
    const { data: branch, error } = await supabase.from('branches').update(data).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return branch;
  }
  static async deleteBranch(id: string) {
    const { error } = await supabase.from('branches').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  // Barbers
  static async listBarbers() {
    const { data, error } = await supabase
      .from('barbers')
      .select('id, display_name, bio, rating_avg, rating_count, live_status, service_radius_km, branch_id, staff_users(full_name, email), branches(id, name)')
      .is('deleted_at', null)
      .order('display_name', { ascending: true });
    if (error) throw new Error(error.message);
    return data;
  }

  static async createBarber(data: any) {
    const { data: barber, error } = await supabase.from('barbers').insert(data).select().single();
    if (error) throw new Error(error.message);
    return barber;
  }
  static async updateBarber(id: string, data: any) {
    const { data: barber, error } = await supabase.from('barbers').update(data).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return barber;
  }
  static async deleteBarber(id: string) {
    const { error } = await supabase.from('barbers').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  // Services
  static async listServices() {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, description, image_url, default_duration_min, is_active, created_at')
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return data;
  }

  static async createService(data: any) {
    const { data: service, error } = await supabase.from('services').insert(data).select().single();
    if (error) throw new Error(error.message);
    return service;
  }
  static async updateService(id: string, data: any) {
    const { data: service, error } = await supabase.from('services').update(data).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return service;
  }
  static async deleteService(id: string) {
    const { error } = await supabase.from('services').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  // Service Prices
  static async listServicePrices() {
    const { data, error } = await supabase
      .from('service_prices')
      .select('id, price_amount, effective_from, effective_to, branch_id, region_id, services(id, name), branches(id, name)')
      .order('effective_from', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }

  static async createServicePrice(data: any) {
    const { data: price, error } = await supabase.from('service_prices').insert(data).select().single();
    if (error) throw new Error(error.message);
    return price;
  }
  static async updateServicePrice(id: string, data: any) {
    const { data: price, error } = await supabase.from('service_prices').update(data).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return price;
  }
  static async deleteServicePrice(id: string) {
    const { error } = await supabase.from('service_prices').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }
}
