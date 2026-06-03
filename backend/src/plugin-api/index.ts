/**
 * @zalocrm/plugin-api — public surface.
 *
 * Plugin (core hoặc EE) chỉ cần import từ đây:
 *   import type { ZaloCrmPlugin, PluginContext } from '@zalocrm/plugin-api';
 *
 * Khi tách repo EE (Phase 7), thư mục này publish thành npm package.
 * Trong repo public hiện tại, EE local import qua đường dẫn './plugin-api/index.js'.
 */
export type {
  ZaloCrmPlugin,
  PluginContext,
  CronJob,
  CapabilityRegistry,
  PolicyRegistry,
  PolicyRequest,
  ScopeRegistry,
  ScopeWhere,
  LicenseService,
  ZaloMessagingCapability,
  InternalContactCapability,
  InternalContactTarget,
  AppConfig,
  AppLogger,
  AppPrisma,
} from './types.js';

export { createPolicyRegistry } from './policy-registry.js';
export { createScopeRegistry } from './scope-registry.js';
export { createCapabilityRegistry } from './capability-registry.js';
