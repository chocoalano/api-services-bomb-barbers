import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { AdminWithdrawalController } from './controller';

export const adminWithdrawalRoutes = new Elysia({ prefix: '/api/v1/admin' })
  .use(staffAuthMiddleware)
  .onBeforeHandle(requirePermission('manage_payment'))
  // ── Customer withdrawals ──────────────────────────────────────────────────
  .get('/withdrawals/customers', AdminWithdrawalController.listCustomerWithdrawals)
  .patch('/withdrawals/customers/:id/approve', AdminWithdrawalController.approveCustomerWithdrawal)
  .patch('/withdrawals/customers/:id/reject', AdminWithdrawalController.rejectCustomerWithdrawal)
  // ── Barber withdrawals ────────────────────────────────────────────────────
  .get('/withdrawals/barbers', AdminWithdrawalController.listBarberWithdrawals)
  .patch('/withdrawals/barbers/:id/approve', AdminWithdrawalController.approveBarberWithdrawal)
  .patch('/withdrawals/barbers/:id/reject', AdminWithdrawalController.rejectBarberWithdrawal);
