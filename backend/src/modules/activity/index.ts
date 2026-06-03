/**
 * Activity plugin — route timeline hoạt động (Phase 4 batch 2 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { timelineRoutes } from './timeline-routes.js';

export const activityPlugin: ZaloCrmPlugin = {
  name: 'activity',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(timelineRoutes);
  },
};
