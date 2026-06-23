import { Elysia } from 'elysia';
import { TrackingController } from './controller';
import { trackingDocs } from './docs';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const trackingRoutes = new Elysia()
  // ── Canonical: /api/v1/customers/appointments/:id ─────────────────────────
  .group('/api/v1/customers/appointments/:id', (app) => app
    .use(customerAuthMiddleware)
    .post('/tracking/start', TrackingController.startTracking, trackingDocs.startTracking)
    .get('/tracking/eta', TrackingController.getETA, trackingDocs.getETA)
    .patch('/tracking/eta', TrackingController.updateETA, trackingDocs.updateETA)
    .patch('/tracking/location', TrackingController.updateETA, trackingDocs.updateLocation)
    .post('/tracking/revoke', TrackingController.revokeTracking)
    .post('/check-in', TrackingController.checkIn, trackingDocs.checkIn)
  )
  // ── Deprecated: /api/v1/customer/appointments/:id → /customers/appointments/:id
  .group('/api/v1/customer/appointments/:id', (app) => app
    .use(customerAuthMiddleware)
    .post('/tracking/start', deprecated('/api/v1/customers/appointments/:id/tracking/start', TrackingController.startTracking), deprecatedDetail)
    .get('/tracking/eta', deprecated('/api/v1/customers/appointments/:id/tracking/eta', TrackingController.getETA), deprecatedDetail)
    .patch('/tracking/eta', deprecated('/api/v1/customers/appointments/:id/tracking/eta', TrackingController.updateETA), deprecatedDetail)
    .patch('/tracking/location', deprecated('/api/v1/customers/appointments/:id/tracking/location', TrackingController.updateETA), deprecatedDetail)
    .post('/tracking/revoke', deprecated('/api/v1/customers/appointments/:id/tracking/revoke', TrackingController.revokeTracking), deprecatedDetail)
    .post('/check-in', deprecated('/api/v1/customers/appointments/:id/check-in', TrackingController.checkIn), deprecatedDetail)
  );
