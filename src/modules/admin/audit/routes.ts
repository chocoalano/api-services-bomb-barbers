import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { AuditController } from './controller';
import { auditDocs } from './docs';

export const auditRoutes = new Elysia({ prefix: '/api/v1/admin/audit-logs' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('view_audit_log'))
  .get('/', AuditController.getLogs, auditDocs.getLogs);
