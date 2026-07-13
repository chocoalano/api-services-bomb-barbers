import { Elysia } from 'elysia';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { CustomerWalletController } from './controller';

export const customerWalletRoutes = new Elysia()
  .group('/api/v1/customers/wallet', (app) => app
    .use(customerAuthMiddleware)
    .get('', CustomerWalletController.getWallet)
    .post('/withdraw', CustomerWalletController.requestWithdraw)
    .post('/topups', CustomerWalletController.createTopup)
    .patch('/topups/:id/confirm', CustomerWalletController.confirmTopup)
    // A10: Fitur tip dinonaktifkan. Endpoint tip tidak lagi didaftarkan.
    // .post('/tip', CustomerWalletController.payTip)
  );
