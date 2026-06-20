// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * user-preference-routes.ts — Per-user key-value preferences (cross-device sync).
 *
 * Use cases:
 *  - timeline.categories.visible: which Activity Log categories user wants in
 *    compact timeline view (default visibility ở frontend constants)
 *  - chat.notes.enterToSave: keyboard pref cho note composer
 *  - ui.compact-mode, ui.theme, etc.
 *
 * Key namespace: lowercase, dot-separated. Value: any JSON.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

const KEY_PATTERN = /^[a-z][a-z0-9._-]{0,79}$/i;

export async function userPreferenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/me/preferences — all keys (cho bootstrap khi load app) ─
  app.get('/api/v1/me/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const prefs = await prisma.userPreference.findMany({
        where: { userId: user.id },
        select: { key: true, value: true, updatedAt: true },
      });
      // Trả về object map { key: value } cho FE dễ consume
      const map: Record<string, unknown> = {};
      for (const p of prefs) map[p.key] = p.value;
      return { preferences: map };
    } catch (err) {
      logger.error('[user-preferences] List error:', err);
      return reply.status(500).send({ error: 'Failed to load preferences' });
    }
  });

  // ── GET /api/v1/me/preferences/:key ─────────────────────────────────────
  app.get('/api/v1/me/preferences/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { key } = request.params;
      if (!KEY_PATTERN.test(key)) return reply.status(400).send({ error: 'Invalid key' });
      const pref = await prisma.userPreference.findUnique({
        where: { userId_key: { userId: user.id, key } },
      });
      return { key, value: pref?.value ?? null };
    } catch (err) {
      logger.error('[user-preferences] Get error:', err);
      return reply.status(500).send({ error: 'Failed to get preference' });
    }
  });

  // ── PUT /api/v1/me/preferences/:key — upsert ────────────────────────────
  app.put('/api/v1/me/preferences/:key', async (request: FastifyRequest<{
    Params: { key: string };
    Body: { value: unknown };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { key } = request.params;
      if (!KEY_PATTERN.test(key)) return reply.status(400).send({ error: 'Invalid key' });
      const value = request.body?.value;
      if (value === undefined) return reply.status(400).send({ error: 'value required' });

      const pref = await prisma.userPreference.upsert({
        where: { userId_key: { userId: user.id, key } },
        create: { userId: user.id, key, value: value as object },
        update: { value: value as object },
      });
      return { key: pref.key, value: pref.value };
    } catch (err) {
      logger.error('[user-preferences] Put error:', err);
      return reply.status(500).send({ error: 'Failed to save preference' });
    }
  });

  // ── DELETE /api/v1/me/preferences/:key — reset về default ───────────────
  app.delete('/api/v1/me/preferences/:key', async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { key } = request.params;
      if (!KEY_PATTERN.test(key)) return reply.status(400).send({ error: 'Invalid key' });
      await prisma.userPreference.deleteMany({ where: { userId: user.id, key } });
      return { ok: true };
    } catch (err) {
      logger.error('[user-preferences] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete preference' });
    }
  });
}
