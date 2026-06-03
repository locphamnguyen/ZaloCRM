/**
 * Public API plugin — gom public-api + webhook-settings (Phase 4 batch 2 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { publicApiRoutes } from './public-api-routes.js';
import { webhookSettingsRoutes } from './webhook-settings-routes.js';

export const apiPlugin: ZaloCrmPlugin = {
  name: 'api',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(publicApiRoutes);
    await app.register(webhookSettingsRoutes);
  },
};
