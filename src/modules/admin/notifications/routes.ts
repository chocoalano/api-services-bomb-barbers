import { Elysia } from 'elysia';
import { staffAuthMiddleware } from '../../../middleware/auth';
import { NotificationSettingsController } from './controller';
import { notificationSettingsDocs } from './docs';

export const adminNotificationRoutes = new Elysia({ prefix: '/api/v1/admin/settings' })
  .use(staffAuthMiddleware)
  .get('/notifications', NotificationSettingsController.getSettings, notificationSettingsDocs.getSettings)
  .put('/notifications', NotificationSettingsController.updateSettings, notificationSettingsDocs.updateSettings);
