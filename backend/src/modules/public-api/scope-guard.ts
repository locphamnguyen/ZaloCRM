/**
 * scope-guard.ts — Fastify preHandler factory: enforces required scope on public API routes.
 * Must run after apiKeyMiddleware (requires request.publicApiContext).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Scope } from './api-key-types.js';

/** Returns a preHandler that 403s if the required scope is not in the key's scope list. */
export function requireScope(scope: Scope) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { scopes } = request.publicApiContext;
    if (!scopes.includes(scope)) {
      return reply.status(403).send({
        error: {
          code: 'insufficient_scope',
          message: `This operation requires the '${scope}' scope`,
        },
      });
    }
  };
}
