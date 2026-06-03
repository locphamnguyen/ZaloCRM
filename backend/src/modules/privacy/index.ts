/**
 * Privacy plugin — PIN-gated visual privacy (Phase 4 batch 3).
 * Module dùng hàm registerPrivacyRoutes(app) thay vì app.register(routes).
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { registerPrivacyRoutes } from './privacy-routes.js';

export const privacyPlugin: ZaloCrmPlugin = {
  name: 'privacy',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await registerPrivacyRoutes(app);
  },
};
