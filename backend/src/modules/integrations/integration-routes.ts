// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * integration-routes.ts — CRUD for external integrations + manual sync trigger.
 * All routes require JWT auth, scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { runSync } from './sync-engine.js';

const VALID_TYPES = ['google_sheets', 'telegram', 'facebook', 'zapier'] as const;

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/integrations — list all integrations for org
  app.get('/api/v1/integrations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const integrations = await prisma.integration.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, orgId: true, type: true, name: true,
          enabled: true, lastSyncAt: true, createdAt: true, updatedAt: true,
          syncLogs: { take: 5, orderBy: { createdAt: 'desc' } },
        },
      });
      return integrations;
    } catch (err) {
      logger.error('[integrations] GET list error:', err);
      return reply.status(500).send({ error: 'Failed to fetch integrations' });
    }
  });

  // POST /api/v1/integrations — create integration (admin+)
  app.post('/api/v1/integrations', { preHandler: requireGrant('settings', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { type, name, config: cfg, enabled } = request.body as {
        type: string; name?: string; config?: Record<string, unknown>; enabled?: boolean;
      };

      if (!type || !VALID_TYPES.includes(type as any)) {
        return reply.status(400).send({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      }

      const integration = await prisma.integration.create({
        data: { orgId, type, name: name || type, config: (cfg ?? {}) as any, enabled: enabled ?? true },
      });
      return reply.status(201).send(integration);
    } catch (err) {
      logger.error('[integrations] POST create error:', err);
      return reply.status(500).send({ error: 'Failed to create integration' });
    }
  });

  // PUT /api/v1/integrations/:id — update integration (admin+)
  app.put('/api/v1/integrations/:id', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };
      const { name, config: cfg, enabled } = request.body as {
        name?: string; config?: Record<string, unknown>; enabled?: boolean;
      };

      const existing = await prisma.integration.findFirst({ where: { id, orgId } });
      if (!existing) return reply.status(404).send({ error: 'Integration not found' });

      const updated = await prisma.integration.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(cfg !== undefined && { config: cfg as any }),
          ...(enabled !== undefined && { enabled }),
        },
      });
      return updated;
    } catch (err) {
      logger.error('[integrations] PUT update error:', err);
      return reply.status(500).send({ error: 'Failed to update integration' });
    }
  });

  // DELETE /api/v1/integrations/:id — remove integration (admin+)
  app.delete('/api/v1/integrations/:id', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.integration.findFirst({ where: { id, orgId } });
      if (!existing) return reply.status(404).send({ error: 'Integration not found' });

      await prisma.integration.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error('[integrations] DELETE error:', err);
      return reply.status(500).send({ error: 'Failed to delete integration' });
    }
  });

  // POST /api/v1/integrations/:id/sync — trigger manual sync (admin+)
  app.post('/api/v1/integrations/:id/sync', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };

      const integration = await prisma.integration.findFirst({ where: { id, orgId } });
      if (!integration) return reply.status(404).send({ error: 'Integration not found' });
      if (!integration.enabled) return reply.status(400).send({ error: 'Integration is disabled' });

      const log = await runSync(integration);
      return log;
    } catch (err) {
      logger.error('[integrations] POST sync error:', err);
      return reply.status(500).send({ error: 'Sync failed' });
    }
  });

  // GET /api/v1/integrations/:id/logs — sync history
  app.get('/api/v1/integrations/:id/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };

      const integration = await prisma.integration.findFirst({ where: { id, orgId } });
      if (!integration) return reply.status(404).send({ error: 'Integration not found' });

      const logs = await prisma.syncLog.findMany({
        where: { integrationId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return logs;
    } catch (err) {
      logger.error('[integrations] GET logs error:', err);
      return reply.status(500).send({ error: 'Failed to fetch sync logs' });
    }
  });
}
