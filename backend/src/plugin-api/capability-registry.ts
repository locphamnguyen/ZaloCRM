/**
 * Capability Registry (primitive 1) — impl tham chiếu.
 *
 * Core provide năng lực dưới 1 key ổn định (vd 'zalo.messaging'); EE get ra dùng.
 * Giữ contract theo key → internal core refactor tự do mà không vỡ EE.
 */
import type { CapabilityRegistry } from './types.js';

export function createCapabilityRegistry(): CapabilityRegistry {
  const registry = new Map<string, unknown>();

  return {
    provide<T>(key: string, impl: T) {
      if (registry.has(key)) {
        throw new Error(`[capability] '${key}' already provided`);
      }
      registry.set(key, impl);
    },

    get<T>(key: string): T {
      if (!registry.has(key)) {
        throw new Error(`[capability] '${key}' not provided by core`);
      }
      return registry.get(key) as T;
    },

    has(key: string): boolean {
      return registry.has(key);
    },
  };
}
