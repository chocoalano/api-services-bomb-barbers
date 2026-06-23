import { Elysia } from 'elysia';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { CustomerAppointmentController } from './controller';
import { appointmentDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

// ── Canonical: /api/v1/customers/appointments ──────────────────────────────
const canonicalAppointmentRoutes = new Elysia({ prefix: '/api/v1/customers/appointments' })
  .use(customerAuthMiddleware)
  .post('/', CustomerAppointmentController.createOnlineBooking, appointmentDocs.customerCreateAppointment)
  .get('/', CustomerAppointmentController.getMyAppointments, appointmentDocs.customerGetAppointments)
  .get('/:id', CustomerAppointmentController.getAppointmentDetail, appointmentDocs.customerGetAppointmentDetail)
  .post('/:id/cancel', CustomerAppointmentController.cancelAppointment, appointmentDocs.customerCancelAppointment)
  .patch('/:id/status', CustomerAppointmentController.updateStatus, appointmentDocs.customerUpdateStatus)
  .patch('/:id/destination', CustomerAppointmentController.updateDestination, appointmentDocs.customerUpdateDestination);

// ── Deprecated: /api/v1/customer/appointments → /api/v1/customers/appointments
const deprecatedAppointmentRoutes = new Elysia({ prefix: '/api/v1/customer/appointments' })
  .use(customerAuthMiddleware)
  .post('/', deprecated('/api/v1/customers/appointments', CustomerAppointmentController.createOnlineBooking), deprecatedDetail)
  .get('/', deprecated('/api/v1/customers/appointments', CustomerAppointmentController.getMyAppointments), deprecatedDetail)
  .get('/:id', deprecated('/api/v1/customers/appointments/:id', CustomerAppointmentController.getAppointmentDetail), deprecatedDetail)
  .post('/:id/cancel', deprecated('/api/v1/customers/appointments/:id/cancel', CustomerAppointmentController.cancelAppointment), deprecatedDetail)
  .patch('/:id/status', deprecated('/api/v1/customers/appointments/:id/status', CustomerAppointmentController.updateStatus), deprecatedDetail);

export const customerAppointmentRoutes = new Elysia()
  .use(canonicalAppointmentRoutes)
  .use(deprecatedAppointmentRoutes);
