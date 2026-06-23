import { Elysia } from 'elysia';
import { WalletService } from './service';
import { createSuccessResponse, createErrorResponse } from '../../shared/response';
import { walletDocs } from './docs';
import { requireBarber } from '../../middleware/rbac';
import { staffAuthMiddleware } from '../../middleware/auth';

export const walletController = new Elysia({ prefix: '/api/v1/barber/wallet' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requireBarber)
  .get('/', async ({ staffId, set }: any) => {
    try {
      const data = await WalletService.getWalletDetails(staffId);
      return createSuccessResponse('Data wallet dan transaksi', data);
    } catch (err: any) {
      set.status = 500;
      return createErrorResponse(err.message || 'Gagal memuat wallet');
    }
  }, walletDocs.getWalletDetails)
  .post('/withdraw', async ({ staffId, body, set }: any) => {
    try {
      const data = await WalletService.requestWithdrawal(staffId, body as any);
      return createSuccessResponse('Permintaan penarikan dana berhasil dikirim', data);
    } catch (err: any) {
      set.status = 400;
      return createErrorResponse(err.message || 'Gagal melakukan penarikan dana');
    }
  }, walletDocs.requestWithdrawal);

