import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBarber } from '../../../middleware/rbac';
import { BarberAppointmentController } from './controller';
import { appointmentDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const barberAppointmentRoutes = new Elysia({ prefix: '/api/v1' })
  .use(staffAuthMiddleware)
  // ── Canonical: /api/v1/barbers ────────────────────────────────────────────
  .group('/barbers', (app) => app
    .onBeforeHandle(requireBarber)
    .patch('/me/status', BarberAppointmentController.setPresenceStatus)
    .get('/queue', BarberAppointmentController.getMyQueue, appointmentDocs.barberGetQueue)
    .get('/appointments/history', BarberAppointmentController.getHistory)
    .get('/appointments/:id', BarberAppointmentController.getDetail)
    .get('/appointments/:id/tracking', BarberAppointmentController.getTracking)
    .get('/appointments/:id/navigation', BarberAppointmentController.getNavigation)
    .patch('/appointments/:id/accept', BarberAppointmentController.acceptOrder, appointmentDocs.barberAcceptOrder)
    .post('/appointments/:id/reject', BarberAppointmentController.rejectOrder)
    .patch('/appointments/:id/no-show', BarberAppointmentController.markNoShow)
    .post('/appointments/:id/tracking', BarberAppointmentController.pushLocation, appointmentDocs.barberPushLocation)
    .patch('/appointments/:id/arrive', BarberAppointmentController.arriveAtLocation, appointmentDocs.barberArriveAtLocation)
    .patch('/appointments/:id/start', BarberAppointmentController.startService, appointmentDocs.barberStartService)
    .patch('/appointments/:id/complete', BarberAppointmentController.completeService, appointmentDocs.barberCompleteService)
  )
  // ── Deprecated: /api/v1/barber → /api/v1/barbers ─────────────────────────
  .group('/barber', (app) => app
    .onBeforeHandle(requireBarber)
    .get('/queue', deprecated('/api/v1/barbers/queue', BarberAppointmentController.getMyQueue), deprecatedDetail)
    .get('/appointments/history', deprecated('/api/v1/barbers/appointments/history', BarberAppointmentController.getHistory), deprecatedDetail)
    .get('/appointments/:id', deprecated('/api/v1/barbers/appointments/:id', BarberAppointmentController.getDetail), deprecatedDetail)
    .get('/appointments/:id/tracking', deprecated('/api/v1/barbers/appointments/:id/tracking', BarberAppointmentController.getTracking), deprecatedDetail)
    .get('/appointments/:id/navigation', deprecated('/api/v1/barbers/appointments/:id/navigation', BarberAppointmentController.getNavigation), deprecatedDetail)
    .patch('/appointments/:id/accept', deprecated('/api/v1/barbers/appointments/:id/accept', BarberAppointmentController.acceptOrder), deprecatedDetail)
    .post('/appointments/:id/reject', deprecated('/api/v1/barbers/appointments/:id/reject', BarberAppointmentController.rejectOrder), deprecatedDetail)
    .patch('/appointments/:id/no-show', deprecated('/api/v1/barbers/appointments/:id/no-show', BarberAppointmentController.markNoShow), deprecatedDetail)
    .post('/appointments/:id/tracking', deprecated('/api/v1/barbers/appointments/:id/tracking', BarberAppointmentController.pushLocation), deprecatedDetail)
    .patch('/appointments/:id/arrive', deprecated('/api/v1/barbers/appointments/:id/arrive', BarberAppointmentController.arriveAtLocation), deprecatedDetail)
    .patch('/appointments/:id/start', deprecated('/api/v1/barbers/appointments/:id/start', BarberAppointmentController.startService), deprecatedDetail)
    .patch('/appointments/:id/complete', deprecated('/api/v1/barbers/appointments/:id/complete', BarberAppointmentController.completeService), deprecatedDetail)
  )
  // ── Deprecated: /api/v1/staff → /api/v1/barbers ──────────────────────────
  .group('/staff', (app) => app
    .onBeforeHandle(requireBarber)
    .get('/queue', deprecated('/api/v1/barbers/queue', BarberAppointmentController.getMyQueue), deprecatedDetail)
  );
