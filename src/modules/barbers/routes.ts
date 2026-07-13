import { Elysia } from 'elysia';
import { barberAppointmentRoutes } from './appointments/routes';
import { barberOpenOrderRoutes } from './open-orders/routes';
import { barberAuthRoutes } from './auth/routes';
import { barberChatRoutes } from './chat/routes';
import { barberCommissionRoutes } from './commissions/routes';
import { barberDashboardRoutes } from './dashboard/routes';
import { barberPortfolioRoutes } from './portfolio/routes';
import { barberMediaRoutes } from './media/routes';
import { walletController } from '../../core/wallets/controller';
import { staffRegisterRoutes } from '../../core/staff-auth/routes';

export const barberRoutes = new Elysia()
  .use(staffRegisterRoutes)
  .use(barberAuthRoutes)
  .use(barberAppointmentRoutes)
  .use(barberOpenOrderRoutes)
  .use(barberChatRoutes)
  .use(barberCommissionRoutes)
  .use(barberDashboardRoutes)
  .use(barberMediaRoutes)
  .use(barberPortfolioRoutes)
  .use(walletController);
