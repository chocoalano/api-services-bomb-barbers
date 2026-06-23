import { Elysia } from 'elysia';
import { CatalogController } from './controller';
import { catalogDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const catalogRoutes = new Elysia()
  // ── Canonical: /api/v1/customers/catalog/branches ─────────────────────────
  .get('/api/v1/customers/catalog/branches', CatalogController.getBranches, catalogDocs.getBranches)
  .get('/api/v1/customers/catalog/branches/:id', CatalogController.getBranchDetail, catalogDocs.getBranchDetail)
  .get('/api/v1/customers/catalog/branches/:id/barbers', CatalogController.getBranchBarbers, catalogDocs.getBranchBarbers)
  .get('/api/v1/customers/catalog/branches/:id/services', CatalogController.getBranchServices, catalogDocs.getBranchServices)
  .get('/api/v1/customers/catalog/branches/:id/services/:serviceId/price', CatalogController.resolveServicePrice, catalogDocs.resolveServicePrice)
  // ── Deprecated: /api/v1/branches → /api/v1/customers/catalog/branches ─────
  .get('/api/v1/branches', deprecated('/api/v1/customers/catalog/branches', CatalogController.getBranches), deprecatedDetail)
  .get('/api/v1/branches/:id', deprecated('/api/v1/customers/catalog/branches/:id', CatalogController.getBranchDetail), deprecatedDetail)
  .get('/api/v1/branches/:id/barbers', deprecated('/api/v1/customers/catalog/branches/:id/barbers', CatalogController.getBranchBarbers), deprecatedDetail)
  .get('/api/v1/branches/:id/services', deprecated('/api/v1/customers/catalog/branches/:id/services', CatalogController.getBranchServices), deprecatedDetail)
  .get('/api/v1/branches/:id/services/:serviceId/price', deprecated('/api/v1/customers/catalog/branches/:id/services/:serviceId/price', CatalogController.resolveServicePrice), deprecatedDetail);
