import { Elysia } from 'elysia';
import { barberAppointmentRoutes } from './appointments/routes';
import { barberOpenOrderRoutes } from './open-orders/routes';
import { barberAuthRoutes } from './auth/routes';
import { barberChatRoutes } from './chat/routes';
import { barberDashboardRoutes } from './dashboard/routes';
import { barberPortfolioRoutes } from './portfolio/routes';
import { barberMediaRoutes } from './media/routes';
import { staffRegisterRoutes } from '../../core/staff-auth/routes';

// [KEBIJAKAN] Permukaan baca pendapatan barber DITUTUP:
//   - `barberCommissionRoutes` (GET /api/v1/barbers/commissions)
//   - `walletController`       (GET /api/v1/barber/wallet, POST .../withdraw)
// Barber tidak diizinkan mengetahui pendapatannya, sehingga menyembunyikan angka
// di aplikasi saja tidak cukup — endpointnya harus ikut dilepas. Komisi tetap
// dicatat otomatis dan dapat dibaca lewat modul admin. Pencairan ditangani admin
// di luar aplikasi barber.

export const barberRoutes = new Elysia()
  .use(staffRegisterRoutes)
  .use(barberAuthRoutes)
  .use(barberAppointmentRoutes)
  .use(barberOpenOrderRoutes)
  .use(barberChatRoutes)
  .use(barberDashboardRoutes)
  .use(barberMediaRoutes)
  .use(barberPortfolioRoutes);
