/**
 * corePlugins — danh sách plugin CORE, nạp theo thứ tự bởi plugin-host.
 *
 * Hiện tại MỚI chuyển 'branding' sang plugin (proof scaffold Phase 2+3).
 * 18 module core còn lại vẫn đăng ký trực tiếp trong app.ts — sẽ migrate dần
 * ở Phase 4 (mỗi PR 1-2 module), thêm vào mảng này theo ĐÚNG thứ tự cũ.
 *
 * ⚠️ THỨ TỰ QUAN TRỌNG: auth/middleware trước, route phụ thuộc sau.
 */
import type { ZaloCrmPlugin } from '../plugin-api/index.js';
import { licensePlugin } from '../core/license-routes.js';
import { brandingPlugin } from './branding/index.js';
import { dashboardPlugin } from './dashboard/index.js';
import { analyticsPlugin } from './analytics/index.js';
import { searchPlugin } from './search/index.js';
import { notificationsPlugin } from './notifications/index.js';
import { scoringPlugin } from './scoring/index.js';
import { activityPlugin } from './activity/index.js';
import { aiPlugin } from './ai/index.js';
import { apiPlugin } from './api/index.js';
import { engagementPlugin } from './engagement/index.js';
import { rbacPlugin } from './rbac/index.js';
import { privacyPlugin } from './privacy/index.js';

export const corePlugins: ZaloCrmPlugin[] = [
  // License status endpoint (core infra)
  licensePlugin,
  // Route thuần, độc lập theo path — thứ tự nội bộ không quan trọng.
  // Batch 1
  brandingPlugin,
  dashboardPlugin,
  analyticsPlugin,
  searchPlugin,
  notificationsPlugin,
  // Batch 2
  scoringPlugin,
  activityPlugin,
  aiPlugin,
  apiPlugin,
  // Batch 3 — module dùng registerXxxRoutes(app)
  engagementPlugin,
  rbacPlugin,
  privacyPlugin,
  // Phase 4 (tiếp) — auth/zalo/chat/contacts/automation... (nhạy thứ tự, migrate sau).
];
