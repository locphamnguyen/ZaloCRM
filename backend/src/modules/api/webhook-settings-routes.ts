// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * webhook-settings-routes.ts — Manage webhook URL/secret and public API key generation.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { emitWebhook } from './webhook-service.js';
import { hashApiKey, maskApiKeyHint } from '../../shared/crypto/api-key-hash.js';
import crypto from 'node:crypto';

export async function webhookSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/settings/webhook — retrieve current webhook config
  app.get('/api/v1/settings/webhook', { preHandler: requireGrant('webhook', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const [urlSetting, secretSetting] = await Promise.all([
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_url' } }),
        prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_secret' } }),
      ]);

      return {
        url: urlSetting?.valuePlain ?? null,
        // Mask secret — show only last 4 chars
        secret: secretSetting?.valuePlain
          ? `${'*'.repeat(Math.max(0, secretSetting.valuePlain.length - 4))}${secretSetting.valuePlain.slice(-4)}`
          : null,
      };
    } catch (err) {
      logger.error('[webhook-settings] GET error:', err);
      return reply.status(500).send({ error: 'Failed to fetch webhook settings' });
    }
  });

  // PUT /api/v1/settings/webhook — save webhook URL and secret
  app.put('/api/v1/settings/webhook', { preHandler: requireGrant('webhook', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { url, secret } = request.body as { url?: string; secret?: string };

      await Promise.all([
        upsertSetting(orgId, 'webhook_url', url ?? ''),
        secret !== undefined ? upsertSetting(orgId, 'webhook_secret', secret) : Promise.resolve(),
      ]);

      return { success: true };
    } catch (err) {
      logger.error('[webhook-settings] PUT error:', err);
      return reply.status(500).send({ error: 'Failed to save webhook settings' });
    }
  });

  // POST /api/v1/settings/webhook/test — deliver a test event to configured URL
  app.post('/api/v1/settings/webhook/test', { preHandler: requireGrant('webhook', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const config = await prisma.appSetting.findFirst({ where: { orgId, settingKey: 'webhook_url' } });
      if (!config?.valuePlain) {
        return reply.status(400).send({ error: 'No webhook URL configured' });
      }

      await emitWebhook(orgId, 'webhook.test', { message: 'Test event from Zalo CRM', orgId });
      return { success: true, sentTo: config.valuePlain };
    } catch (err) {
      logger.error('[webhook-settings] Test error:', err);
      return reply.status(500).send({ error: 'Failed to send test webhook' });
    }
  });

  // POST /api/v1/settings/api-key/generate — generate new public API key
  app.post('/api/v1/settings/api-key/generate', { preHandler: requireGrant('webhook', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      // P2 (H1) — chỉ lưu SHA-256 hash + hint đã mask; KHÔNG lưu key thật. Trả key gốc
      // cho user 1 lần duy nhất ở response này (không lấy lại được sau đó).
      const newKey = `zcrm_${crypto.randomBytes(24).toString('hex')}`;
      await prisma.appSetting.upsert({
        where: { orgId_settingKey: { orgId, settingKey: 'public_api_key' } },
        create: { orgId, settingKey: 'public_api_key', valuePlain: maskApiKeyHint(newKey), valueHash: hashApiKey(newKey) },
        update: { valuePlain: maskApiKeyHint(newKey), valueHash: hashApiKey(newKey) },
      });

      return { key: newKey };
    } catch (err) {
      logger.error('[webhook-settings] Generate API key error:', err);
      return reply.status(500).send({ error: 'Failed to generate API key' });
    }
  });

  // GET /api/v1/settings/api-key — retrieve masked API key
  app.get('/api/v1/settings/api-key', { preHandler: requireGrant('webhook', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;

      const setting = await prisma.appSetting.findFirst({ where: { orgId, settingKey: 'public_api_key' } });
      if (!setting?.valuePlain) return { key: null };

      // P2 (H1): sau khi có valueHash, valuePlain CHỈ còn là hint đã mask (key thật không
      // lưu) → trả thẳng. Legacy row chưa backfill (valueHash null) → vẫn mask plaintext
      // để không lộ full key qua API cho tới khi backfill chạy.
      if (setting.valueHash) return { key: setting.valuePlain };
      const k = setting.valuePlain;
      const masked = k.length > 12 ? `${k.slice(0, 12)}${'*'.repeat(k.length - 16)}${k.slice(-4)}` : `${k.slice(0, 4)}****`;
      return { key: masked };
    } catch (err) {
      logger.error('[webhook-settings] GET API key error:', err);
      return reply.status(500).send({ error: 'Failed to fetch API key' });
    }
  });
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function upsertSetting(orgId: string, settingKey: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey } },
    create: { orgId, settingKey, valuePlain: value },
    update: { valuePlain: value },
  });
}
