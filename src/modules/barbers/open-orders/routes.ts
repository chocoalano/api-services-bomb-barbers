import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBarber } from '../../../middleware/rbac';
import { BarberOpenOrderController } from './controller';
import { openOrderDocs } from './docs';

export const barberOpenOrderRoutes = new Elysia({ prefix: '/api/v1' })
  .use(staffAuthMiddleware)
  .group('/barbers', (app) => app
    .onBeforeHandle(requireBarber)
    .get('/open-orders', BarberOpenOrderController.list, openOrderDocs.list)
    .post('/open-orders', BarberOpenOrderController.open, openOrderDocs.open)
    .post('/open-orders/close', BarberOpenOrderController.close, openOrderDocs.close)
  );
