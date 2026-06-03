/**
 * Policy Registry (primitive 2) — impl tham chiếu.
 *
 * Cơ chế guard slot: core gọi `check(name, req)` tại điểm cần khóa.
 * - Chưa ai register(name) → trả TRUE (không khóa, bản community chạy bình thường).
 * - EE register(name, fn) → fn quyết định cho qua hay không (vd kiểm OTP/PIN).
 */
import type { PolicyRegistry, PolicyRequest } from './types.js';

export function createPolicyRegistry(): PolicyRegistry {
  const policies = new Map<string, (r: PolicyRequest) => Promise<boolean>>();

  return {
    register(name, fn) {
      if (policies.has(name)) {
        // Một policy / 1 name. Tránh EE đăng ký chồng ngầm.
        throw new Error(`[policy] '${name}' already registered`);
      }
      policies.set(name, fn);
    },

    async check(name, r) {
      const fn = policies.get(name);
      return fn ? fn(r) : true; // no registrant ⇒ allow
    },
  };
}
