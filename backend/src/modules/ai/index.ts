/**
 * AI plugin — route AI assistant (Phase 4 batch 2 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { aiRoutes } from './ai-routes.js';

export const aiPlugin: ZaloCrmPlugin = {
  name: 'ai',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(aiRoutes);
  },
};
