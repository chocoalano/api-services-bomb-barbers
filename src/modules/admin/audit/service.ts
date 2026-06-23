import { auditQueue } from '../../../lib/queue';

export class AuditService {
  static async logAction(
    actorType: 'admin' | 'customer' | 'system',
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    beforeState: any,
    afterState: any,
    branchId?: string | null
  ) {
    await auditQueue.add('insert_audit_log', {
      actor_type: actorType,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before: beforeState,
      after: afterState,
      branch_id: branchId ?? null
    });
  }
}
