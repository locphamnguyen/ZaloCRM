/**
 * Analytics plugin — gom route analytics + saved-report (Phase 4 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { analyticsRoutes } from './analytics-routes.js';
import { savedReportRoutes } from './saved-report-routes.js';

export const analyticsPlugin: ZaloCrmPlugin = {
  name: 'analytics',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(analyticsRoutes);
    await app.register(savedReportRoutes);
  },
};
