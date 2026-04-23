/**
 * api-key-middleware.ts — Fastify preHandler: validates X-API-Key header.
 * Sets request.publicApiContext on success; 401 on any auth failure.
 * Fires lastUsedAt update asynchronously (never blocks response).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { hashKey } from './api-key-service.js';
import type { Scope } from './api-key-types.js';

export async function apiKeyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Case-insensitive header lookup (Fastify lowercases all headers)
  const rawKey = request.headers['x-api-key'];
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    return reply.status(401).send({
      error: { code: 'missing_api_key', message: 'X-API-Key header is required' },
    });
  }

  const hash = hashKey(rawKey.trim());

  let row: {
    id: string;
    orgId: string;
    scopes: unknown;
    revokedAt: Date | null;
    expiresAt: Date | null;
  } | null;

  try {
    row = await prisma.apiKey.findUnique({
      where: { keyHash: hash },
      select: { id: true, orgId: true, scopes: true, revokedAt: true, expiresAt: true },
    });
  } catch {
    return reply.status(500).send({
      error: { code: 'auth_error', message: 'Authentication failed' },
    });
  }

  if (!row) {
    return reply.status(401).send({
      error: { code: 'invalid_api_key', message: 'API key not found' },
    });
  }

  if (row.revokedAt !== null) {
    return reply.status(401).send({
      error: { code: 'revoked_api_key', message: 'API key has been revoked' },
    });
  }

  if (row.expiresAt !== null && row.expiresAt < new Date()) {
    return reply.status(401).send({
      error: { code: 'expired_api_key', message: 'API key has expired' },
    });
  }

  const rawScopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : ['read'];

  request.publicApiContext = {
    orgId: row.orgId,
    scopes: rawScopes as Scope[],
    apiKeyId: row.id,
  };

  // Fire-and-forget: update lastUsedAt without blocking response
  prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // Non-critical — ignore failures
    });
}
