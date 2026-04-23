/**
 * api-key-types.ts — Shared types for the public API / API key system.
 */

export type Scope = 'read' | 'write';

/** Injected onto request by apiKeyMiddleware after successful validation. */
export interface PublicApiContext {
  orgId: string;
  scopes: Scope[];
  apiKeyId: string;
}
