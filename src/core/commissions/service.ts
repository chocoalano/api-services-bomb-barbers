import { supabase } from '../../lib/supabase';

export class CommissionService {
  static async resolveCommissionRule(barberId: string, serviceId: string, branchId: string, regionId: string) {
    const now = new Date().toISOString();
    
    // Fetch active rules that match our scopes
    const { data: rules, error } = await supabase
      .from('commission_rules')
      .select('*')
      .lte('effective_from', now)
      .or(`effective_to.is.null,effective_to.gte.${now}`)
      .or(`scope.eq.global,scope_ref_id.in.(${barberId},${serviceId},${branchId},${regionId})`);

    if (error || !rules) throw new Error('Gagal mengambil commission rules: ' + error?.message);

    // Filter secara presisi di memori untuk memastikan ID-nya benar-benar tepat
    const validRules = rules.filter(r => {
      if (r.scope === 'global') return true;
      if (r.scope === 'barber' && r.scope_ref_id === barberId) return true;
      if (r.scope === 'service' && r.scope_ref_id === serviceId) return true;
      if (r.scope === 'branch' && r.scope_ref_id === branchId) return true;
      if (r.scope === 'region' && r.scope_ref_id === regionId) return true;
      return false;
    });

    if (validRules.length === 0) throw new Error('Tidak ada aturan komisi yang aktif untuk transaksi ini.');

    // Urutkan berdasarkan prioritas: barber (5) > service (4) > branch (3) > region (2) > global (1)
    const priorityMap: Record<string, number> = { barber: 5, service: 4, branch: 3, region: 2, global: 1 };
    
    validRules.sort((a, b) => priorityMap[b.scope] - priorityMap[a.scope]);

    console.log(`[DEBUG] Resolved Rule for Barber ${barberId}, Service ${serviceId}:`, validRules[0]);

    return validRules[0];
  }

  static async calculateCommission(appointmentId: string) {
    const { data: apt, error: aptErr } = await supabase
      .from('appointments')
      .select(`*, branches(region_id), barbers(id), appointment_services(service_id, price_amount), payments(status, tip_amount)`)
      .eq('id', appointmentId)
      .single();

    if (aptErr || !apt) throw new Error('Appointment tidak ditemukan');
    
    const payment = Array.isArray(apt.payments) ? apt.payments[0] : apt.payments;
    if (!payment || payment.status !== 'paid') throw new Error('Pesanan ini belum lunas dibayar');

    const barberId = apt.barbers?.id || apt.barber_id; 
    const branchId = apt.branch_id;
    const regionId = apt.branches?.region_id;

    if (!barberId) throw new Error('Tidak ada Barber yang ditugaskan pada pesanan ini');

    let totalBaseAmount = 0;
    let totalBarberShare = 0;
    let totalBranchShare = 0;
    let totalHqShare = 0;
    
    let strongestRule: any = null;
    let highestPriority = -1;
    const priorityMap: Record<string, number> = { barber: 5, service: 4, branch: 3, region: 2, global: 1 };

    // Kalkulasi Base secara parsial per servis (Opsi B)
    for (const s of apt.appointment_services) {
      const rule = await this.resolveCommissionRule(barberId, s.service_id, branchId, regionId);
      const rulePriority = priorityMap[rule.scope];
      if (rulePriority > highestPriority) {
        highestPriority = rulePriority;
        strongestRule = rule;
      }

      const price = Number(s.price_amount) || 0;
      totalBaseAmount += price;

      if (price > 0) {
        // Safe math: mencegah HQ minus
        let bPct = Number(rule.barber_pct);
        let brPct = Number(rule.branch_pct);
        if (bPct + brPct > 100) {
          const factor = 100 / (bPct + brPct);
          bPct = Math.floor(bPct * factor);
          brPct = Math.floor(brPct * factor);
        }

        const bShare = Math.floor(price * bPct / 100);
        const brShare = Math.floor(price * brPct / 100);
        const hShare = Math.max(0, price - bShare - brShare);

        totalBarberShare += bShare;
        totalBranchShare += brShare;
        totalHqShare += hShare;
      }
    }

    if (!strongestRule) {
      strongestRule = await this.resolveCommissionRule(barberId, null as any, branchId, regionId);
    }

    // Logika Uang Tip menggunakan Strongest Rule
    let tipAmount = Number(payment.tip_amount || 0);
    if (tipAmount > 0) {
      if (strongestRule.tip_to_barber) {
        totalBarberShare += tipAmount;
      } else {
        let bPct = Number(strongestRule.barber_pct);
        let brPct = Number(strongestRule.branch_pct);
        if (bPct + brPct > 100) {
          const factor = 100 / (bPct + brPct);
          bPct = Math.floor(bPct * factor);
          brPct = Math.floor(brPct * factor);
        }

        const barberTip = Math.floor(tipAmount * bPct / 100);
        const branchTip = Math.floor(tipAmount * brPct / 100);
        const hqTip = Math.max(0, tipAmount - barberTip - branchTip);

        totalBarberShare += barberTip;
        totalBranchShare += branchTip;
        totalHqShare += hqTip;
      }
    }

    const entryData = {
      appointment_id: appointmentId,
      commission_rule_id: strongestRule.id,
      base_amount: totalBaseAmount,
      barber_share: totalBarberShare,
      branch_share: totalBranchShare,
      hq_share: totalHqShare,
      tip_amount: tipAmount,
      calculated_at: new Date().toISOString()
    };

    const { data: newEntry, error: insertErr } = await supabase.from('commission_entries').insert(entryData).select().single();
    if (insertErr) {
      if (insertErr.code === '23505') throw new Error('Komisi untuk pesanan ini sudah pernah dihitung (Idempotency Protection)');
      throw new Error('Gagal menyimpan komisi: ' + insertErr.message);
    }

    const summaryDate = new Date().toISOString().slice(0, 10);
    await this.updateBarberDailyStats(barberId, branchId, summaryDate, totalBarberShare);
    await this.updateDailyBranchSummaries(branchId, summaryDate, totalBaseAmount, totalBranchShare, totalHqShare);

    if (totalBarberShare > 0) {
      const { error: walletErr } = await supabase.rpc('deposit_commission', {
        p_barber_id: barberId,
        p_amount: totalBarberShare,
        p_commission_id: newEntry.id,
        p_description: `Komisi layanan (${totalBaseAmount})` + (tipAmount > 0 ? ` + Tip (${tipAmount})` : '')
      });
      if (walletErr) {
        console.error(`[CommissionService] Gagal deposit komisi ke wallet barber ${barberId}:`, walletErr);
      }
    }

    return newEntry;
  }

  static async updateBarberDailyStats(barberId: string, branchId: string, date: string, commissionEarned: number) {
    const { data: existing } = await supabase
      .from('barber_daily_stats')
      .select('id, heads_count, commission_earned')
      .eq('barber_id', barberId)
      .eq('summary_date', date)
      .single();

    if (existing) {
      await supabase.from('barber_daily_stats').update({
        heads_count: existing.heads_count + 1,
        commission_earned: Number(existing.commission_earned) + commissionEarned
      }).eq('id', existing.id);
    } else {
      await supabase.from('barber_daily_stats').insert({
        barber_id: barberId,
        branch_id: branchId,
        summary_date: date,
        heads_count: 1,
        commission_earned: commissionEarned
      });
    }
  }

  static async updateDailyBranchSummaries(branchId: string, date: string, revenue: number, branchShare: number, hqShare: number) {
    const { data: existing } = await supabase
      .from('daily_branch_summaries')
      .select('id, total_revenue, branch_share_total, hq_share_total, total_appointments')
      .eq('branch_id', branchId)
      .eq('summary_date', date)
      .single();

    if (existing) {
      await supabase.from('daily_branch_summaries').update({
        total_appointments: existing.total_appointments + 1,
        total_revenue: Number(existing.total_revenue) + revenue,
        branch_share_total: Number(existing.branch_share_total) + branchShare,
        hq_share_total: Number(existing.hq_share_total) + hqShare
      }).eq('id', existing.id);
    } else {
      await supabase.from('daily_branch_summaries').insert({
        branch_id: branchId,
        summary_date: date,
        total_appointments: 1,
        total_revenue: revenue,
        branch_share_total: branchShare,
        hq_share_total: hqShare
      });
    }
  }
}
