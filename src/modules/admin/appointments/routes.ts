import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBranchScope, requireBranchScopeResolved, requirePermission } from '../../../middleware/rbac';
import { appointmentBranchResolver } from '../../../shared/branch-resolvers';
import { AdminAppointmentController } from './controller';
import { AdminAppointmentListController } from './list.controller';
import { appointmentDocs } from './docs';

export const adminAppointmentRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_appointment'))
  // Daftar & statistik appointment lintas cabang. Cakupan cabang di-resolve per
  // peran di dalam controller (super_admin: semua; branch_admin: hanya cabangnya),
  // sehingga tidak memakai guard requireBranchScope berbasis param.
  .get('/appointments', AdminAppointmentListController.list, appointmentDocs.adminList)
  .get('/appointments/stats', AdminAppointmentListController.stats, appointmentDocs.adminStats)
  .group('/branches/:branchId', (app) => app
    .onBeforeHandle(requireBranchScope((context: any) => context.params.branchId))
    .post('/walk-ins', AdminAppointmentController.createWalkIn, appointmentDocs.adminCreateWalkIn)
    .get('/queue', AdminAppointmentController.getBranchQueue, appointmentDocs.adminGetQueue)
  )
  .group('/appointments/:id', (app) => app
    .onBeforeHandle(requireBranchScopeResolved(appointmentBranchResolver))
    .patch('/status', AdminAppointmentController.updateStatus, appointmentDocs.adminUpdateStatus)
    .patch('/barber', AdminAppointmentController.reassignBarber, appointmentDocs.adminReassignBarber)
    .patch('/destination', AdminAppointmentController.updateDestination, appointmentDocs.adminUpdateDestination)
  );
