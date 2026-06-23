import { Elysia } from 'elysia';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { ContentController } from './controller';
import { contentDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const customerContentRoutes = new Elysia()
  // ── Canonical ─────────────────────────────────────────────────────────────
  .get('/api/v1/customers/content/banners', ContentController.getBanners, contentDocs.getBanners)
  .get('/api/v1/customers/content/gallery', ContentController.getGallery, contentDocs.getGallery)
  .group('/api/v1/customers', (app) => app
    .use(customerAuthMiddleware)
    .get('/notifications', ContentController.getCustomerNotifications, contentDocs.getCustomerNotifications)
    // read-all BEFORE :id so 'read-all' is not consumed as an ID param
    .patch('/notifications/read-all', ContentController.markAllNotificationsRead)
    .patch('/notifications/:id/read', ContentController.markNotificationRead)
  )
  // ── Deprecated: /api/v1/banners → /api/v1/customers/content/banners ───────
  .get('/api/v1/banners', deprecated('/api/v1/customers/content/banners', ContentController.getBanners), deprecatedDetail)
  .get('/api/v1/gallery', deprecated('/api/v1/customers/content/gallery', ContentController.getGallery), deprecatedDetail)
  // ── Deprecated: /api/v1/notifications → /api/v1/customers/notifications ──
  .group('/api/v1', (app) => app
    .use(customerAuthMiddleware)
    .get('/notifications', deprecated('/api/v1/customers/notifications', ContentController.getCustomerNotifications), deprecatedDetail)
  )
  // ── Deprecated: /api/v1/customer/notifications → /api/v1/customers/notifications
  .group('/api/v1/customer', (app) => app
    .use(customerAuthMiddleware)
    .get('/notifications', deprecated('/api/v1/customers/notifications', ContentController.getCustomerNotifications), deprecatedDetail)
  );
