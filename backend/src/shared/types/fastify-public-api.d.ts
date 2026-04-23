/**
 * fastify-public-api.d.ts — Module augmentation for public API context on FastifyRequest.
 * Populated by apiKeyMiddleware after successful key validation.
 */
import type { PublicApiContext } from '../../modules/public-api/api-key-types.js';

declare module 'fastify' {
  interface FastifyRequest {
    publicApiContext: PublicApiContext;
  }
}
