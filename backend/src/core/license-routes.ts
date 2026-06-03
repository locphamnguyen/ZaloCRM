/**
 * License plugin — endpoint cho frontend đọc trạng thái feature.
 * GET /api/v1/license → { edition, features, expiresAt, seats }
 * Không trả thông tin nhạy cảm, chỉ danh sách feature đang bật.
 */
import type { ZaloCrmPlugin } from '../plugin-api/index.js';

export const licensePlugin: ZaloCrmPlugin = {
  name: 'license',
  version: '1.0.0',
  edition: 'core',
  register({ app, license }) {
    app.get('/api/v1/license', async () => ({
      edition: license.edition(),
      features: license.features(),
      expiresAt: license.expiresAt(),
      seats: license.seats(),
    }));
  },
};
