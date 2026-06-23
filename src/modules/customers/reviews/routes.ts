import { Elysia } from 'elysia';
import { ReviewController } from './controller';
import { reviewDocs } from './docs';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const reviewRoutes = new Elysia()
  // ── Canonical: /api/v1/customers/appointments/:id/reviews ─────────────────
  .group('/api/v1/customers/appointments', (app) => app
    .use(customerAuthMiddleware)
    .post('/:id/reviews', ReviewController.create, reviewDocs.customerCreateReview)
  )
  // ── Deprecated: /api/v1/customer/appointments/:id/reviews(|review) ────────
  .group('/api/v1/customer/appointments', (app) => app
    .use(customerAuthMiddleware)
    // Singular /review → canonical /reviews
    .post('/:id/review', deprecated('/api/v1/customers/appointments/:id/reviews', ReviewController.create), deprecatedDetail)
    .post('/:id/reviews', deprecated('/api/v1/customers/appointments/:id/reviews', ReviewController.create), deprecatedDetail)
  );
