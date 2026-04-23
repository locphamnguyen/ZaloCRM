/**
 * attr-def-routes.ts — CRUD endpoints for custom attribute definitions + contact custom-attrs patch.
 *
 * Endpoints:
 *   GET    /api/v1/custom-attrs              — list defs for org (JWT)
 *   POST   /api/v1/custom-attrs              — create def (admin)
 *   PATCH  /api/v1/custom-attrs/:id          — update label/required/enumValues (admin)
 *   DELETE /api/v1/custom-attrs/:id          — soft-delete (admin)
 *   PATCH  /api/v1/contacts/:id/custom-attrs — partial merge of contact.customAttrs (JWT)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireRole } from '../../auth/role-middleware.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  listAttrDefs,
  createAttrDef,
  updateAttrDef,
  softDeleteAttrDef,
  AttrDefError,
} from './attr-def-service.js';
import { validateCustomAttrs } from './attr-validator.js';
import type { CreateAttrDefInput, UpdateAttrDefInput } from './attr-def-types.js';

export async function attrDefRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/custom-attrs ───────────────────────────────────────────────
  app.get('/api/v1/custom-attrs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const defs = await listAttrDefs(user.orgId);
      return { defs };
    } catch (err) {
      logger.error('[custom-attrs] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch attribute definitions' });
    }
  });

  // ── POST /api/v1/custom-attrs ──────────────────────────────────────────────
  app.post(
    '/api/v1/custom-attrs',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const body = request.body as Record<string, unknown>;

        if (!body.key || typeof body.key !== 'string') {
          return reply.status(400).send({ error: 'key is required (string)' });
        }
        if (!body.label || typeof body.label !== 'string') {
          return reply.status(400).send({ error: 'label is required (string)' });
        }
        if (!body.dataType || typeof body.dataType !== 'string') {
          return reply.status(400).send({ error: 'dataType is required (string)' });
        }

        const input: CreateAttrDefInput = {
          key: body.key,
          label: body.label,
          dataType: body.dataType as CreateAttrDefInput['dataType'],
          enumValues: Array.isArray(body.enumValues) ? (body.enumValues as string[]) : null,
          required: typeof body.required === 'boolean' ? body.required : false,
        };

        const def = await createAttrDef(user.orgId, input);
        return reply.status(201).send(def);
      } catch (err) {
        if (err instanceof AttrDefError) {
          return reply.status(400).send({ error: err.message, code: err.code });
        }
        logger.error('[custom-attrs] Create error:', err);
        return reply.status(500).send({ error: 'Failed to create attribute definition' });
      }
    },
  );

  // ── PATCH /api/v1/custom-attrs/:id ────────────────────────────────────────
  app.patch(
    '/api/v1/custom-attrs/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, unknown>;

        const input: UpdateAttrDefInput & { key?: unknown; dataType?: unknown } = {
          key: body.key,
          dataType: body.dataType,
          label: typeof body.label === 'string' ? body.label : undefined,
          enumValues: Array.isArray(body.enumValues) ? (body.enumValues as string[]) : undefined,
          required: typeof body.required === 'boolean' ? body.required : undefined,
        };

        const def = await updateAttrDef(user.orgId, id, input);
        return def;
      } catch (err) {
        if (err instanceof AttrDefError) {
          const status = err.code === 'not_found' ? 404 : 400;
          return reply.status(status).send({ error: err.message, code: err.code });
        }
        logger.error('[custom-attrs] Update error:', err);
        return reply.status(500).send({ error: 'Failed to update attribute definition' });
      }
    },
  );

  // ── DELETE /api/v1/custom-attrs/:id ───────────────────────────────────────
  app.delete(
    '/api/v1/custom-attrs/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };
        await softDeleteAttrDef(user.orgId, id);
        return { success: true };
      } catch (err) {
        if (err instanceof AttrDefError) {
          const status = err.code === 'not_found' ? 404 : 400;
          return reply.status(status).send({ error: err.message, code: err.code });
        }
        logger.error('[custom-attrs] Delete error:', err);
        return reply.status(500).send({ error: 'Failed to delete attribute definition' });
      }
    },
  );

  // ── PATCH /api/v1/contacts/:id/custom-attrs ───────────────────────────────
  // Partial merge: reads existing attrs, validates incoming, merges, writes in txn.
  app.patch(
    '/api/v1/contacts/:id/custom-attrs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = request.user!;
        const { id } = request.params as { id: string };
        const incoming = request.body as Record<string, unknown>;

        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          return reply.status(400).send({ error: 'Body must be a JSON object of {key: value} pairs' });
        }

        const updated = await prisma.$transaction(async (tx) => {
          const contact = await tx.contact.findFirst({
            where: { id, orgId: user.orgId },
            select: { id: true, customAttrs: true },
          });
          if (!contact) return null;

          const existing =
            contact.customAttrs && typeof contact.customAttrs === 'object'
              ? (contact.customAttrs as Record<string, unknown>)
              : {};

          const validation = await validateCustomAttrs(user.orgId, incoming, existing);
          if (!validation.ok) {
            // Signal validation failure via a thrown error to abort txn cleanly
            const err = new Error('VALIDATION_FAILED');
            (err as Error & { validationErrors: unknown }).validationErrors = validation.errors;
            throw err;
          }

          const merged = { ...existing, ...incoming };
          return tx.contact.update({
            where: { id },
            data: { customAttrs: merged as Prisma.InputJsonValue },
            select: { id: true, customAttrs: true },
          });
        });

        if (updated === null) {
          return reply.status(404).send({ error: 'Contact not found' });
        }

        return updated;
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'VALIDATION_FAILED') {
          const typed = err as Error & { validationErrors: unknown };
          return reply.status(400).send({ error: 'Validation failed', errors: typed.validationErrors });
        }
        logger.error('[custom-attrs] Contact patch error:', err);
        return reply.status(500).send({ error: 'Failed to update contact custom attributes' });
      }
    },
  );
}
