import { redis } from '../../../lib/redis';
import { supabase } from '../../../lib/supabase';

const BRANCH_QUEUE_STATUSES = ['pending', 'confirmed', 'in_queue', 'in_service'];

export class QueueService {
  static async getBranchActiveQueueSnapshot(branchId: string) {
    const { data: queue, error } = await supabase
      .from('appointments')
      .select('id, barber_id, status, customer_id')
      .eq('branch_id', branchId)
      .in('status', BRANCH_QUEUE_STATUSES)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error('Gagal mengambil realtime queue: ' + error.message);
    }

    return Promise.all((queue || []).map(async (apt) => {
      const etaRaw = await redis.get(`appointment:eta:${apt.id}`);
      let eta = null;

      if (etaRaw) {
        try {
          eta = JSON.parse(etaRaw);
        } catch {
          eta = null;
        }
      }

      return { ...apt, eta };
    }));
  }

}
