import { Elysia } from 'elysia';
import { AvailabilityController } from './controller';
import { availabilityDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const availabilityRoutes = new Elysia()
  // ── Canonical ─────────────────────────────────────────────────────────────
  .get('/api/v1/customers/catalog/branches/:id/available-slots', AvailabilityController.getAvailableSlots, availabilityDocs.getAvailableSlots)
  // ── Deprecated: /api/v1/branches/:id/available-slots ─────────────────────
  .get('/api/v1/branches/:id/available-slots', deprecated('/api/v1/customers/catalog/branches/:id/available-slots', AvailabilityController.getAvailableSlots), deprecatedDetail);
