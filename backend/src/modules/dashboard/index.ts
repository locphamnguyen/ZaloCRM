/**
 * Dashboard plugin — gom route dashboard + report (Phase 4 migrate).
 * Route handler giữ NGUYÊN; đây chỉ là lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { dashboardRoutes } from './dashboard-routes.js';
import { reportRoutes } from './report-routes.js';

export const dashboardPlugin: ZaloCrmPlugin = {
  name: 'dashboard',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(dashboardRoutes);
    await app.register(reportRoutes);
  },
};
