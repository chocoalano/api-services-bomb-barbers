import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requirePermission, requireRole } from '../../../middleware/rbac';
import { AdminCatalogController } from './controller';
import { adminCatalogDocs } from './docs';

// Listing cabang untuk admin operasional (branch_admin dan super_admin).
export const adminBranchListRoute = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .get('/branches', AdminCatalogController.listBranches, adminCatalogDocs.listBranches);

// Manajemen master data (branch/barber/service/harga) — endpoint HQ, dipindah ke /hq.
export const adminCatalogRoutes = new Elysia({ prefix: '/api/v1/hq' })
  .use(staffAuthMiddleware)
  
  // Branches
  .get('/branches', AdminCatalogController.listBranches, {
    ...adminCatalogDocs.listHqBranches,
    beforeHandle: requireRole('super_admin')
  })
  .group('/branches', (app) => app
    .onBeforeHandle(requirePermission('manage_branch'))
    .post('/', AdminCatalogController.createBranch, adminCatalogDocs.createBranch)
    .put('/:id', AdminCatalogController.updateBranch, adminCatalogDocs.updateBranch)
    .delete('/:id', AdminCatalogController.deleteBranch, adminCatalogDocs.deleteBranch)
  )
  // Barbers
  .get('/barbers', AdminCatalogController.listBarbers, {
    ...adminCatalogDocs.listBarbers,
    beforeHandle: requirePermission('manage_barber')
  })
  // POST create sengaja di top-level (sejajar GET), BUKAN di dalam group('/barbers').
  // Kombinasi get('/barbers') + group('/barbers').post('/') membuat route POST hanya
  // ter-resolve setelah kompilasi penuh via .listen() dan menghasilkan 404 pada
  // app.handle() (dipakai test). Menaruhnya di top-level menghindari ambiguitas
  // trailing-slash tersebut sehingga konsisten di runtime maupun test.
  .post('/barbers', AdminCatalogController.createBarber, {
    ...adminCatalogDocs.createBarber,
    beforeHandle: requirePermission('manage_barber')
  })
  .group('/barbers', (app) => app
    .onBeforeHandle(requirePermission('manage_barber'))
    // [REVISI C1] Onboarding kepster: daftar pending & konfirmasi (approve/reject).
    .get('/pending', AdminCatalogController.listPendingBarbers, adminCatalogDocs.listPendingBarbers)
    .patch('/:id/approval', AdminCatalogController.updateBarberApproval, adminCatalogDocs.updateBarberApproval)
    .put('/:id', AdminCatalogController.updateBarber, adminCatalogDocs.updateBarber)
    .delete('/:id', AdminCatalogController.deleteBarber, adminCatalogDocs.deleteBarber)
  )
  // Services
  .get('/services', AdminCatalogController.listServices, {
    ...adminCatalogDocs.listServices,
    beforeHandle: requirePermission('manage_service')
  })
  .group('/services', (app) => app
    .onBeforeHandle(requirePermission('manage_service'))
    .post('/', AdminCatalogController.createService, adminCatalogDocs.createService)
    .put('/:id', AdminCatalogController.updateService, adminCatalogDocs.updateService)
    .delete('/:id', AdminCatalogController.deleteService, adminCatalogDocs.deleteService)
  )
  // Service Prices
  .get('/service-prices', AdminCatalogController.listServicePrices, {
    ...adminCatalogDocs.listServicePrices,
    beforeHandle: requirePermission('manage_service')
  })
  .group('/service-prices', (app) => app
    .onBeforeHandle(requirePermission('manage_service'))
    .post('/', AdminCatalogController.createServicePrice, adminCatalogDocs.createServicePrice)
    .put('/:id', AdminCatalogController.updateServicePrice, adminCatalogDocs.updateServicePrice)
    .delete('/:id', AdminCatalogController.deleteServicePrice, adminCatalogDocs.deleteServicePrice)
  );
