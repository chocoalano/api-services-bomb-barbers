import { db } from '../../lib/db';
import { snakeKeys } from '../../db/helpers';
import { commissionRules, appointments, branches, appointmentServices, payments } from '../../db/schema';
import { and, or, eq, isNull, lte, gte, inArray } from 'drizzle-orm';
import { asRpcResult, recordCommissionAtomic } from '../../db/procedures';

export class CommissionService {
  static async resolveCommissionRule(barberId: string, serviceId: string, branchId: string, regionId: string) {
    const now = new Date().toISOString();
    
    // Fetch active rules that match our scopes
    const scopeRefs = [barberId, serviceId, branchId, regionId].filter(Boolean) as string[];
    const rules = snakeKeys(
      await db
        .select()
        .from(commissionRules)
        .where(
          and(
            lte(commissionRules.effectiveFrom, now),
            or(isNull(commissionRules.effectiveTo), gte(commissionRules.effectiveTo, now)),
            or(
              eq(commissionRules.scope, 'global'),
              scopeRefs.length ? inArray(commissionRules.scopeRefId, scopeRefs) : undefined
            )
          )
        )
    );

    if (!rules) throw new Error('Gagal mengambil commission rules');

    // Filter secara presisi di memori untuk memastikan ID-nya benar-benar tepat
    const validRules = rules.filter((r: any) => {
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
    
    validRules.sort((a: any, b: any) => priorityMap[b.scope] - priorityMap[a.scope]);

    return validRules[0];
  }

  static async calculateCommission(appointmentId: string) {
    const [apt] = snakeKeys(
      await db.select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1)
    );

    if (!apt) throw new Error('Appointment tidak ditemukan');

    // Rangkai relasi embedded (pengganti nested select relasi).
    const [branchRow] = await db
      .select({ region_id: branches.regionId })
      .from(branches)
      .where(eq(branches.id, apt.branch_id))
      .limit(1);
    apt.branches = branchRow ?? null;
    apt.barbers = apt.barber_id ? { id: apt.barber_id } : null;
    apt.appointment_services = snakeKeys(
      await db
        .select({ service_id: appointmentServices.serviceId, price_amount: appointmentServices.priceAmount })
        .from(appointmentServices)
        .where(eq(appointmentServices.appointmentId, appointmentId))
    );
    apt.payments = snakeKeys(
      await db
        .select({ status: payments.status, tip_amount: payments.tipAmount })
        .from(payments)
        .where(eq(payments.appointmentId, appointmentId))
    );
    
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

    const summaryDate = new Date().toISOString().slice(0, 10);
    const description = `Komisi layanan (${totalBaseAmount})` + (tipAmount > 0 ? ` + Tip (${tipAmount})` : '');

    // Rekam entry komisi + deposit wallet + agregat harian dalam satu transaksi
    // atomik. Bila deposit gagal, entry ikut rollback → re-run bisa retry bersih
    // (tidak ada entry yatim yang mengunci idempotency). (H1, M2)
    const { data: newEntry, error: rpcErr } = await asRpcResult(() =>
      recordCommissionAtomic({
        appointmentId,
        commissionRuleId: strongestRule.id,
        baseAmount: totalBaseAmount,
        barberShare: totalBarberShare,
        branchShare: totalBranchShare,
        hqShare: totalHqShare,
        tipAmount,
        barberId,
        branchId,
        summaryDate,
        description
      })
    );

    if (rpcErr) {
      if (rpcErr.code === '23505' || /commission_entries_appointment_id_unique/.test(rpcErr.message || '')) {
        throw new Error('Komisi untuk pesanan ini sudah pernah dihitung (Idempotency Protection)');
      }
      throw new Error('Gagal menyimpan komisi: ' + rpcErr.message);
    }

    return newEntry;
  }
}
