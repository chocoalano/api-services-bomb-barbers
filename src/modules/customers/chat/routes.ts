import { Elysia } from 'elysia';
import { customerAuthMiddleware } from '../../../middleware/auth';
import { ChatController } from './controller';
import { chatDocs } from './docs';
import { deprecated, deprecatedDetail } from '../../../shared/deprecation';

export const customerChatRoutes = new Elysia()
  // ── Canonical ─────────────────────────────────────────────────────────────
  .group('/api/v1/customers/appointments/:id', (app) => app
    .use(customerAuthMiddleware)
    .get('/chat', ChatController.getChatHistory, chatDocs.getChatHistory)
    .post('/chat', ChatController.sendMessage, chatDocs.sendMessage)
  )
  // ── Deprecated: /api/v1/customer/appointments/:id → /customers/appointments/:id
  .group('/api/v1/customer/appointments/:id', (app) => app
    .use(customerAuthMiddleware)
    .get('/chat', deprecated('/api/v1/customers/appointments/:id/chat', ChatController.getChatHistory), deprecatedDetail)
    .post('/chat', deprecated('/api/v1/customers/appointments/:id/chat', ChatController.sendMessage), deprecatedDetail)
  );
