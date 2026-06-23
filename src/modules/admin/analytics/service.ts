import { supabase } from '../../../lib/supabase';

export class AnalyticsService {
  async getBranchesAnalytics() {
    // We aggregate data from daily summaries
    const { data, error } = await supabase
      .from('daily_branch_summaries')
      .select('*, branch:branches(name)')
      .order('summary_date', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    return data;
  }

  async exportRevenueCSV(query: { start_date?: string, end_date?: string, branch_id?: string }) {
    let dbQuery = supabase.from('invoices').select('*, payment:payments(appointment_id, total_amount, status, appointment:appointments(branch_id, branch:branches(name)))');
    
    if (query.start_date) dbQuery = dbQuery.gte('created_at', query.start_date);
    if (query.end_date) dbQuery = dbQuery.lte('created_at', query.end_date);
    
    const { data, error } = await dbQuery;
    if (error) throw new Error(error.message);

    const filtered = query.branch_id 
      ? (data || []).filter((inv: any) => inv.payment?.appointment?.branch_id === query.branch_id)
      : (data || []);

    const headers = ['Invoice ID', 'Appointment ID', 'Branch Name', 'Total Amount', 'Created At'];
    const rows = filtered.map((inv: any) => [
      inv.id,
      inv.payment?.appointment_id,
      inv.payment?.appointment?.branch?.name || 'N/A',
      inv.payment?.total_amount,
      inv.created_at
    ]);

    return [headers, ...rows].map(e => e.join(',')).join('\n');
  }

  async exportCommissionCSV(query: { start_date?: string, end_date?: string, barber_id?: string }) {
    let dbQuery = supabase.from('commission_entries').select('*, appointment:appointments(barber_id, barber:barbers(display_name))');
    
    if (query.start_date) dbQuery = dbQuery.gte('created_at', query.start_date);
    if (query.end_date) dbQuery = dbQuery.lte('created_at', query.end_date);
    
    const { data, error } = await dbQuery;
    if (error) throw new Error(error.message);

    const filtered = query.barber_id 
      ? (data || []).filter((c: any) => c.appointment?.barber_id === query.barber_id)
      : (data || []);

    const headers = ['ID', 'Barber Name', 'Base Amount', 'Barber Share', 'Tip', 'Created At'];
    const rows = filtered.map((c: any) => [
      c.id,
      c.appointment?.barber?.display_name || 'N/A',
      c.base_amount,
      c.barber_share,
      c.tip_amount,
      c.created_at
    ]);

    return [headers, ...rows].map(e => e.join(',')).join('\n');
  }
}
