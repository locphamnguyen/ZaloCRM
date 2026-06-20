// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * preset-routes.ts — SavedFilterPreset CRUD cho Inbox Triage Filter (Phase 6+).
 *
 * Preset = combo filter user lưu để 1-click recall.
 * Vd "Sáng nay xử lý" = { quickPills: ['unread', 'unanswered'], tabBox: 'main',
 *                          tabType: 'user', sortMode: 'unread-first' }
 *
 * Endpoints:
 *   GET    /api/v1/filter-presets         — list của user
 *   POST   /api/v1/filter-presets         — tạo từ filter hiện tại
 *   PUT    /api/v1/filter-presets/:id     — đổi tên/emoji/filterJson
 *   DELETE /api/v1/filter-presets/:id     — xoá preset
 *   POST   /api/v1/filter-presets/:id/use — mark last-used (cho future smart sort)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function presetRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /filter-presets ─────────────────────────────────────────────────
  app.get('/api/v1/filter-presets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const presets = await prisma.savedFilterPreset.findMany({
        where: { userId: user.id, orgId: user.orgId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return { presets };
    } catch (err) {
      logger.error({ err }, 'GET filter-presets failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── POST /filter-presets ────────────────────────────────────────────────
  app.post('/api/v1/filter-presets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as {
        name: string;
        emoji?: string;
        filterJson: Record<string, unknown>;
      };
      if (!body.name?.trim() || !body.filterJson) {
        return reply.status(400).send({ error: 'name_and_filterJson_required' });
      }

      const dupe = await prisma.savedFilterPreset.findFirst({
        where: { userId: user.id, name: body.name.trim() },
      });
      if (dupe) return reply.status(409).send({ error: 'duplicate_name' });

      const last = await prisma.savedFilterPreset.findFirst({
        where: { userId: user.id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const nextOrder = (last?.sortOrder ?? -1) + 1;

      const preset = await prisma.savedFilterPreset.create({
        data: {
          orgId: user.orgId,
          userId: user.id,
          name: body.name.trim(),
          emoji: body.emoji || '⭐',
          filterJson: body.filterJson as any,
          sortOrder: nextOrder,
        },
      });
      return reply.status(201).send(preset);
    } catch (err) {
      logger.error({ err }, 'POST filter-presets failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── PUT /filter-presets/:id ─────────────────────────────────────────────
  app.put<{ Params: { id: string } }>(
    '/api/v1/filter-presets/:id',
    async (request, reply) => {
      try {
        const user = request.user!;
        const body = request.body as {
          name?: string;
          emoji?: string;
          filterJson?: Record<string, unknown>;
          sortOrder?: number;
        };

        const preset = await prisma.savedFilterPreset.findUnique({
          where: { id: request.params.id },
        });
        if (!preset || preset.userId !== user.id) {
          return reply.status(404).send({ error: 'preset_not_found' });
        }

        const updated = await prisma.savedFilterPreset.update({
          where: { id: request.params.id },
          data: {
            name: body.name?.trim() ?? undefined,
            emoji: body.emoji ?? undefined,
            filterJson: (body.filterJson as any) ?? undefined,
            sortOrder: body.sortOrder ?? undefined,
          },
        });
        return updated;
      } catch (err) {
        logger.error({ err }, 'PUT filter-preset failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── DELETE /filter-presets/:id ──────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/v1/filter-presets/:id',
    async (request, reply) => {
      try {
        const user = request.user!;
        const preset = await prisma.savedFilterPreset.findUnique({
          where: { id: request.params.id },
        });
        if (!preset || preset.userId !== user.id) {
          return reply.status(404).send({ error: 'preset_not_found' });
        }
        await prisma.savedFilterPreset.delete({
          where: { id: request.params.id },
        });
        return reply.status(204).send();
      } catch (err) {
        logger.error({ err }, 'DELETE preset failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── POST /filter-presets/:id/use — mark last used ──────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/v1/filter-presets/:id/use',
    async (request, reply) => {
      try {
        const user = request.user!;
        const preset = await prisma.savedFilterPreset.findUnique({
          where: { id: request.params.id },
        });
        if (!preset || preset.userId !== user.id) {
          return reply.status(404).send({ error: 'preset_not_found' });
        }
        await prisma.savedFilterPreset.update({
          where: { id: request.params.id },
          data: { lastUsedAt: new Date() },
        });
        return { ok: true };
      } catch (err) {
        logger.error({ err }, 'POST preset use failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );
}
