/**
 * Scoring plugin — route lead-scoring (Phase 4 batch 2 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { scoringRoutes } from './scoring-routes.js';

export const scoringPlugin: ZaloCrmPlugin = {
  name: 'scoring',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(scoringRoutes);
  },
};
