import { Elysia } from 'elysia';
import { customerAuthRoutes } from './auth/routes';
import { availabilityRoutes } from './availability/routes';
import { customerAppointmentRoutes } from './appointments/routes';
import { catalogRoutes } from './catalog/routes';
import { customerChatRoutes } from './chat/routes';
import { customerContentRoutes } from './content/routes';
import { customerMediaRoutes } from './media/routes';
import { customerPaymentRoutes } from './payments/routes';
import { reviewRoutes } from './reviews/routes';
import { trackingRoutes } from './tracking/routes';

export const customerRoutes = new Elysia()
  .use(customerAuthRoutes)
  .use(availabilityRoutes)
  .use(customerAppointmentRoutes)
  .use(catalogRoutes)
  .use(customerChatRoutes)
  .use(customerContentRoutes)
  .use(customerMediaRoutes)
  .use(customerPaymentRoutes)
  .use(reviewRoutes)
  .use(trackingRoutes);
