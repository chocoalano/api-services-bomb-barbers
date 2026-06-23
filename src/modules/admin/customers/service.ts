import { supabase } from '../../../lib/supabase';

export class CustomerSearchService {
  /**
   * Mencari customer berdasarkan nama atau nomor telepon (case-insensitive, partial match).
   * Pencarian menggunakan ILIKE pada field `full_name` dan `phone`.
   */
  static async searchCustomers(query: string, limit: number = 10) {
    const sanitized = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${sanitized}%`;
    const resolvedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

    const { data, error } = await supabase
      .from('customers')
      .select('id, full_name, phone, email')
      .is('deleted_at', null)
      .or(`full_name.ilike.${pattern},phone.ilike.${pattern}`)
      .order('full_name', { ascending: true })
      .limit(resolvedLimit);

    if (error) throw new Error('Gagal mencari pelanggan: ' + error.message);

    return (data ?? []).map((c: any) => ({
      id: c.id,
      full_name: c.full_name,
      phone: c.phone ?? null,
      email: c.email ?? null
    }));
  }
}
