/**
 * Branding plugin — module core ĐẦU TIÊN chuyển sang ZaloCrmPlugin (proof Phase 4).
 *
 * Route handler giữ NGUYÊN (branding-routes.ts không đổi). File này chỉ là lớp
 * mỏng bọc lại để plugin-host nạp. Pattern này áp dụng cho 18 module core còn lại.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { brandingRoutes } from './branding-routes.js';

export const brandingPlugin: ZaloCrmPlugin = {
  name: 'branding',
  version: '1.0.0',
  edition: 'core',
  register({ app }) {
    app.register(brandingRoutes);
  },
};
