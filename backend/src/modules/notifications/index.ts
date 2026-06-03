/**
 * Notifications plugin — route thông báo (Phase 4 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { notificationRoutes } from './notification-routes.js';

export const notificationsPlugin: ZaloCrmPlugin = {
  name: 'notifications',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(notificationRoutes);
  },
};
