import { createSuccessResponse, createErrorResponse } from '../../../shared/response';
import { db } from '../../../lib/db';
import { snakeKeys } from '../../../db/helpers';
import { auditLogs } from '../../../db/schema';
import { and, eq, inArray, desc, sql, type SQL } from 'drizzle-orm';
import { getRbacProfile } from '../../../middleware/rbac';

export class AuditController {
  static async getLogs({ query, staffId, set }: any) {
    try {
      const { entity_type, entity_id, branch_id, limit, offset } = query;
      const resolvedLimit = Math.min(Number(limit) || 50, 500);
      const resolvedOffset = Math.max(Number(offset) || 0, 0);

      const profile = await getRbacProfile(staffId);

      const filters: SQL[] = [];
      if (entity_type) filters.push(eq(auditLogs.entityType, entity_type));
      if (entity_id) filters.push(eq(auditLogs.entityId, entity_id));

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
          filters.push(eq(auditLogs.branchId, targetId));
        } else {
          filters.push(inArray(auditLogs.branchId, allowedIds));
        }
      } else if (branch_id) {
        filters.push(eq(auditLogs.branchId, branch_id));
      }

      const where = filters.length ? and(...filters) : undefined;

      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(desc(auditLogs.createdAt))
          .limit(resolvedLimit)
          .offset(resolvedOffset),
        db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(where)
      ]);

      return createSuccessResponse('Audit logs berhasil diambil', snakeKeys(rows), {
        total: Number(countRows[0]?.count ?? 0),
        limit: resolvedLimit,
        offset: resolvedOffset
      });
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message);
    }
  }
}
