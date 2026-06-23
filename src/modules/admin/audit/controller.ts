import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { supabase } from '../../../lib/supabase';
import { getRbacProfile } from '../../../middleware/rbac';

export class AuditController {
  static async getLogs({ query, staffId, set }: any) {
    try {
      const { entity_type, entity_id, branch_id, limit, offset } = query;
      const resolvedLimit = Math.min(Number(limit) || 50, 500);
      const resolvedOffset = Math.max(Number(offset) || 0, 0);

      const profile = await getRbacProfile(staffId);

      let dbQuery = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(resolvedOffset, resolvedOffset + resolvedLimit - 1);

      if (entity_type) dbQuery = dbQuery.eq('entity_type', entity_type);
      if (entity_id) dbQuery = dbQuery.eq('entity_id', entity_id);

      if (!profile.isGlobal) {
        // Non-global staff hanya bisa melihat log cabang mereka sendiri.
        // Jika ada filter branch_id dari query, pastikan tetap dalam scope yang diizinkan.
        const allowedIds = profile.branchIds;
        if (allowedIds.length === 0) {
          return createSuccessResponse('Audit logs berhasil diambil', [], {
            total: 0, limit: resolvedLimit, offset: resolvedOffset
          });
        }
        const targetId = branch_id && allowedIds.includes(branch_id) ? branch_id : null;
        if (targetId) {
          dbQuery = dbQuery.eq('branch_id', targetId);
        } else {
          dbQuery = dbQuery.in('branch_id', allowedIds);
        }
      } else if (branch_id) {
        dbQuery = dbQuery.eq('branch_id', branch_id);
      }

      const { data, count, error } = await dbQuery;

      if (error) throw new Error(error.message);

      return createSuccessResponse('Audit logs berhasil diambil', data, {
        total: count ?? 0,
        limit: resolvedLimit,
        offset: resolvedOffset
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }
}
