import { Elysia } from 'elysia';
import { barberAppointmentRoutes } from './appointments/routes';
import { barberAuthRoutes } from './auth/routes';
import { barberChatRoutes } from './chat/routes';
import { barberCommissionRoutes } from './commissions/routes';
import { barberDashboardRoutes } from './dashboard/routes';
import { barberPortfolioRoutes } from './portfolio/routes';
import { barberMediaRoutes } from './media/routes';

export const barberRoutes = new Elysia()
  .use(barberAuthRoutes)
  .use(barberAppointmentRoutes)
  .use(barberChatRoutes)
  .use(barberCommissionRoutes)
  .use(barberDashboardRoutes)
  .use(barberMediaRoutes)
  .use(barberPortfolioRoutes);
