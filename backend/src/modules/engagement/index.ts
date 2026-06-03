/**
 * Engagement plugin — heatmap timeline + admin recompute/backfill (Phase 4 batch 3).
 * Module dùng hàm registerEngagementRoutes(app) thay vì app.register(routes).
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { registerEngagementRoutes } from './engagement-routes.js';

export const engagementPlugin: ZaloCrmPlugin = {
  name: 'engagement',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await registerEngagementRoutes(app);
  },
};
