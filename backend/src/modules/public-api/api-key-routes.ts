/**
 * api-key-routes.ts — Admin endpoints to manage API keys (JWT auth, owner/admin only).
 * GET    /api/api-keys        — list all keys for org (no hash exposed)
 * POST   /api/api-keys        — create; returns full raw key ONCE
 * DELETE /api/api-keys/:id    — revoke (soft-delete)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { listKeys, createKey, revokeKey } from './api-key-service.js';
import type { Scope } from './api-key-types.js';

const VALID_SCOPES: Scope[] = ['read', 'write'];

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  // All admin key management routes require JWT + owner/admin role
  const preHandler = [authMiddleware, requireRole('owner', 'admin')];

  // GET /api/api-keys — list keys (prefix only, no hash)
  app.get(
    '/api/api-keys',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const keys = await listKeys(orgId);
        return reply.send({
          data: keys.map((k) => ({
            id: k.id,
            name: k.name,
            prefix: k.keyPrefix,
            scopes: k.scopes,
            lastUsedAt: k.lastUsedAt,
            expiresAt: k.expiresAt,
            revokedAt: k.revokedAt,
            createdAt: k.createdAt,
          })),
        });
      } catch {
        return reply.status(500).send({
          error: { code: 'list_failed', message: 'Failed to list API keys' },
        });
      }
    },
  );

  // POST /api/api-keys — create new key; raw key returned ONCE
  app.post(
    '/api/api-keys',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId, id: userId } = request.user!;
        const body = request.body as Record<string, unknown>;

        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
          return reply.status(400).send({
            error: { code: 'name_required', message: 'name is required' },
          });
        }

        // Validate scopes
        const rawScopes = Array.isArray(body.scopes) ? body.scopes : ['read'];
        const scopes: Scope[] = [];
        for (const s of rawScopes) {
          if (!VALID_SCOPES.includes(s as Scope)) {
            return reply.status(400).send({
              error: {
                code: 'invalid_scope',
                message: `Invalid scope '${s}'. Allowed: ${VALID_SCOPES.join(', ')}`,
              },
            });
          }
          scopes.push(s as Scope);
        }

        // Optional expiry
        let expiresAt: Date | undefined;
        if (body.expiresAt) {
          const parsed = new Date(body.expiresAt as string);
          if (isNaN(parsed.getTime())) {
            return reply.status(400).send({
              error: { code: 'invalid_expires_at', message: 'expiresAt must be a valid ISO date' },
            });
          }
          if (parsed <= new Date()) {
            return reply.status(400).send({
              error: { code: 'invalid_expires_at', message: 'expiresAt must be in the future' },
            });
          }
          expiresAt = parsed;
        }

        const { row, rawKey } = await createKey(orgId, userId, name, scopes, expiresAt);

        return reply.status(201).send({
          data: {
            id: row.id,
            name: row.name,
            key: rawKey, // shown ONCE — not retrievable again
            prefix: row.keyPrefix,
            scopes: row.scopes,
            expiresAt: row.expiresAt,
            createdAt: row.createdAt,
          },
        });
      } catch {
        return reply.status(500).send({
          error: { code: 'create_failed', message: 'Failed to create API key' },
        });
      }
    },
  );

  // DELETE /api/api-keys/:id — revoke
  app.delete(
    '/api/api-keys/:id',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const { id } = request.params as { id: string };
        const ok = await revokeKey(id, orgId);
        if (!ok) {
          return reply.status(404).send({
            error: { code: 'not_found', message: 'API key not found or already revoked' },
          });
        }
        return reply.status(200).send({ data: { revoked: true } });
      } catch {
        return reply.status(500).send({
          error: { code: 'revoke_failed', message: 'Failed to revoke API key' },
        });
      }
    },
  );
}
