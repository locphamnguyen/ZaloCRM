/**
 * Search plugin — route tìm kiếm (Phase 4 migrate).
 * Route handler giữ NGUYÊN; lớp mỏng cho plugin-host nạp.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { searchRoutes } from './search-routes.js';

export const searchPlugin: ZaloCrmPlugin = {
  name: 'search',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await app.register(searchRoutes);
  },
};
