import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { requireBarber } from '../../../middleware/rbac';
import { ChatController } from './controller';
import { chatDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const barberChatRoutes = new Elysia()
  .use(staffAuthMiddleware)
  .onBeforeHandle(requireBarber)
  // ── Canonical: /api/v1/barbers/appointments/:id ───────────────────────────
  .get('/api/v1/barbers/appointments/:id/chat', ChatController.getChatHistory, chatDocs.getChatHistory)
  .post('/api/v1/barbers/appointments/:id/chat', ChatController.sendMessage, chatDocs.sendMessage)
  // ── Deprecated: /api/v1/barber/appointments/:id → /barbers ───────────────
  .get('/api/v1/barber/appointments/:id/chat', deprecated('/api/v1/barbers/appointments/:id/chat', ChatController.getChatHistory), deprecatedDetail)
  .post('/api/v1/barber/appointments/:id/chat', deprecated('/api/v1/barbers/appointments/:id/chat', ChatController.sendMessage), deprecatedDetail);
