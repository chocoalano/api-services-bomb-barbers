import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBarber } from '../../../middleware/rbac';
import { CommissionController } from './controller';
import { commissionDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const barberCommissionRoutes = new Elysia()
  .use(staffAuthMiddleware)
  .onBeforeHandle(requireBarber)
  // ── Canonical ─────────────────────────────────────────────────────────────
  .get('/api/v1/barbers/commissions', CommissionController.getBarberCommissions, commissionDocs.getBarberCommissions)
  // ── Deprecated: /api/v1/barber → /api/v1/barbers ─────────────────────────
  .get('/api/v1/barber/commissions', deprecated('/api/v1/barbers/commissions', CommissionController.getBarberCommissions), deprecatedDetail);
