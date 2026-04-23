/**
 * v1-routes.ts — Public API v1 endpoints mounted at /api/external/v1 prefix.
 * Auth: apiKeyMiddleware + rateLimiterMiddleware on every route.
 * Scope enforcement per route via requireScope().
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { apiKeyMiddleware } from './api-key-middleware.js';
import { rateLimiterMiddleware } from './rate-limiter.js';
import { requireScope } from './scope-guard.js';
import { logPublicApiWrite } from './audit-log.js';
import { getAllAttrs } from '../contacts/custom-attrs/attr-resolver.js';
import { validateCustomAttrs } from '../contacts/custom-attrs/attr-validator.js';
import { listAttrDefs } from '../contacts/custom-attrs/attr-def-service.js';
import { openapiSpec } from './openapi-spec.js';

const authChain = [apiKeyMiddleware, rateLimiterMiddleware];

export async function publicApiV1Routes(app: FastifyInstance): Promise<void> {
  // ── GET /docs — OpenAPI JSON (no auth) ──────────────────────────────────
  app.get('/docs', async (_req, reply) => {
    return reply.send(openapiSpec);
  });

  // ── GET /contacts ────────────────────────────────────────────────────────
  app.get(
    '/contacts',
    { preHandler: [...authChain, requireScope('read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.publicApiContext;
        const q = request.query as Record<string, string>;
        const page = Math.max(1, parseInt(q.page ?? '1') || 1);
        const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20') || 20));

        const where: Record<string, unknown> = { orgId, mergedInto: null };
        if (q.phone) where.phone = { contains: q.phone };
        if (q.status) where.status = q.status;
        if (q.tag) where.tags = { has: q.tag };

        const [contacts, total] = await Promise.all([
          prisma.contact.findMany({
            where,
            select: { id: true, fullName: true, crmName: true, phone: true, email: true, status: true, tags: true, createdAt: true, avatarUrl: true },
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.contact.count({ where }),
        ]);

        return reply.send({ data: contacts, pagination: { page, limit, total } });
      } catch (err) {
        logger.error('[public-api v1] GET /contacts error:', err);
        return reply.status(500).send({ error: { code: 'internal_error', message: 'Failed to fetch contacts' } });
      }
    },
  );

  // ── GET /contacts/:id ────────────────────────────────────────────────────
  app.get(
    '/contacts/:id',
    { preHandler: [...authChain, requireScope('read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.publicApiContext;
        const { id } = request.params as { id: string };
        const attrs = await getAllAttrs(id, orgId).catch(() => null);
        if (!attrs) return reply.status(404).send({ error: { code: 'not_found', message: 'Contact not found' } });
        return reply.send({ data: { id, ...attrs } });
      } catch (err) {
        logger.error('[public-api v1] GET /contacts/:id error:', err);
        return reply.status(500).send({ error: { code: 'internal_error', message: 'Failed to fetch contact' } });
      }
    },
  );

  // ── POST /contacts ───────────────────────────────────────────────────────
  app.post(
    '/contacts',
    { preHandler: [...authChain, requireScope('write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId, apiKeyId, scopes } = request.publicApiContext;
        const body = request.body as Record<string, unknown>;

        if (!body.fullName && !body.phone) {
          return reply.status(400).send({ error: { code: 'validation_error', message: 'fullName or phone is required' } });
        }

        if (body.customAttrs && typeof body.customAttrs === 'object') {
          const result = await validateCustomAttrs(orgId, body.customAttrs as Record<string, unknown>);
          if (!result.ok) {
            return reply.status(400).send({ error: { code: 'invalid_custom_attrs', message: 'Custom attribute validation failed', details: result.errors } });
          }
        }

        const contact = await prisma.contact.create({
          data: {
            orgId,
            fullName: typeof body.fullName === 'string' ? body.fullName : null,
            phone: typeof body.phone === 'string' ? body.phone : null,
            email: typeof body.email === 'string' ? body.email : null,
            status: typeof body.status === 'string' ? body.status : 'new',
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
            customAttrs: body.customAttrs ? (body.customAttrs as object) : undefined,
          },
        });

        logPublicApiWrite(orgId, 'create_contact', 'contact', contact.id, apiKeyId, scopes);
        return reply.status(201).send({ data: contact });
      } catch (err) {
        logger.error('[public-api v1] POST /contacts error:', err);
        return reply.status(500).send({ error: { code: 'internal_error', message: 'Failed to create contact' } });
      }
    },
  );

  // ── PATCH /contacts/:id ──────────────────────────────────────────────────
  app.patch(
    '/contacts/:id',
    { preHandler: [...authChain, requireScope('write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId, apiKeyId, scopes } = request.publicApiContext;
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, unknown>;

        const existing = await prisma.contact.findFirst({
          where: { id, orgId },
          select: { id: true, customAttrs: true },
        });
        if (!existing) return reply.status(404).send({ error: { code: 'not_found', message: 'Contact not found' } });

        if (body.customAttrs && typeof body.customAttrs === 'object') {
          const existingAttrs = existing.customAttrs && typeof existing.customAttrs === 'object'
            ? (existing.customAttrs as Record<string, unknown>) : {};
          const result = await validateCustomAttrs(orgId, body.customAttrs as Record<string, unknown>, existingAttrs);
          if (!result.ok) {
            return reply.status(400).send({ error: { code: 'invalid_custom_attrs', message: 'Custom attribute validation failed', details: result.errors } });
          }
        }

        const updateData: Record<string, unknown> = {};
        if (body.fullName !== undefined) updateData.fullName = body.fullName;
        if (body.phone !== undefined) updateData.phone = body.phone;
        if (body.email !== undefined) updateData.email = body.email;
        if (body.status !== undefined) updateData.status = body.status;
        if (body.tags !== undefined) updateData.tags = body.tags;
        if (body.customAttrs !== undefined) updateData.customAttrs = body.customAttrs as object;

        const updated = await prisma.contact.update({ where: { id }, data: updateData });
        logPublicApiWrite(orgId, 'update_contact', 'contact', id, apiKeyId, scopes);
        return reply.send({ data: updated });
      } catch (err) {
        logger.error('[public-api v1] PATCH /contacts/:id error:', err);
        return reply.status(500).send({ error: { code: 'internal_error', message: 'Failed to update contact' } });
      }
    },
  );

  // ── GET /custom-attrs ────────────────────────────────────────────────────
  app.get(
    '/custom-attrs',
    { preHandler: [...authChain, requireScope('read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.publicApiContext;
        const defs = await listAttrDefs(orgId);
        return reply.send({ data: defs });
      } catch (err) {
        logger.error('[public-api v1] GET /custom-attrs error:', err);
        return reply.status(500).send({ error: { code: 'internal_error', message: 'Failed to list attribute definitions' } });
      }
    },
  );

  // ── POST /contacts/:id/messages — text-only send (v1) ───────────────────
  app.post(
    '/contacts/:id/messages',
    { preHandler: [...authChain, requireScope('write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId, apiKeyId, scopes } = request.publicApiContext;
        const { id: contactId } = request.params as { id: string };
        const body = request.body as Record<string, unknown>;

        // blockId not supported in v1
        if (body.blockId) {
          return reply.status(400).send({ error: { code: 'not_implemented_yet', message: 'blockId is not supported in v1; use text only' } });
        }

        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) {
          return reply.status(400).send({ error: { code: 'validation_error', message: 'text is required' } });
        }

        // Find contact (org-scoped)
        const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId }, select: { id: true } });
        if (!contact) return reply.status(404).send({ error: { code: 'not_found', message: 'Contact not found' } });

        // Find most recent active conversation for this contact
        const conversation = await prisma.conversation.findFirst({
          where: { contactId, orgId },
          orderBy: { lastMessageAt: 'desc' },
          select: { id: true, zaloAccountId: true, externalThreadId: true, threadType: true },
        });

        if (!conversation?.externalThreadId) {
          return reply.status(400).send({ error: { code: 'no_conversation', message: 'No active Zalo conversation found for this contact' } });
        }

        const instance = zaloPool.getInstance(conversation.zaloAccountId);
        if (!instance?.api) {
          return reply.status(400).send({ error: { code: 'zalo_not_connected', message: 'Zalo account is not connected' } });
        }

        const threadType = conversation.threadType === 'group' ? 1 : 0;
        await instance.api.sendMessage({ msg: text }, conversation.externalThreadId, threadType);

        // Persist message record
        const message = await prisma.message.create({
          data: {
            id: randomUUID(),
            conversationId: conversation.id,
            senderType: 'self',
            senderUid: '',
            senderName: 'API',
            content: text,
            contentType: 'text',
            sentAt: new Date(),
          },
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });

        logPublicApiWrite(orgId, 'send_message', 'message', message.id, apiKeyId, scopes);
        return reply.send({ data: { messageId: message.id, sent: true } });
      } catch (err) {
        logger.error('[public-api v1] POST /contacts/:id/messages error:', err);
        return reply.status(500).send({ error: { code: 'internal_error', message: 'Failed to send message' } });
      }
    },
  );
}
