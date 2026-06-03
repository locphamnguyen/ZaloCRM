/**
 * Scope Registry (primitive 3) — impl tham chiếu.
 *
 * Data-scoping slot: core gọi `resolve(name, userId, orgId)` tại route trả list.
 * - Chưa ai register(name) → null (không lọc → community thấy hết).
 * - EE register(name, fn) → fn trả 1 WHERE-fragment Prisma, core merge vào `where`.
 */
import type { ScopeRegistry, ScopeWhere } from './types.js';

export function createScopeRegistry(): ScopeRegistry {
  const providers = new Map<
    string,
    (userId: string, orgId: string) => Promise<ScopeWhere | null>
  >();

  return {
    register(name, fn) {
      if (providers.has(name)) {
        throw new Error(`[scope] '${name}' already registered`);
      }
      providers.set(name, fn);
    },

    async resolve(name, userId, orgId) {
      const fn = providers.get(name);
      return fn ? fn(userId, orgId) : null; // no registrant ⇒ no filter
    },
  };
}
