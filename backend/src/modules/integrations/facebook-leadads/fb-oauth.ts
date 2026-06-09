/**
 * fb-oauth.ts — Admin endpoints để connect / disconnect / status FB Page.
 *
 * Phase 1: anh manually paste Page access token vào UI (vì App Review 2-7 ngày).
 * Phase 2: full OAuth flow với Meta Login.
 *
 * Endpoints (auth required, owner/admin only):
 *   POST   /api/v1/integrations/facebook/connect — paste pageId + pageAccessToken
 *   GET    /api/v1/integrations/facebook/status — list connected pages
 *   DELETE /api/v1/integrations/facebook/:id — disconnect page
 *   POST   /api/v1/integrations/facebook/:id/rotate-verify-token — sinh verify_token mới
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { encryptToken, decryptToken, generateWebhookVerifyToken } from '../_shared/token-encryption.util.js';

export async function fbIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── POST /connect — paste pageId + accessToken ───────────────────────────
  app.post('/api/v1/integrations/facebook/connect', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = request.body as { pageId?: string; pageName?: string; pageAccessToken?: string };
    if (!body.pageId?.trim()) return reply.status(400).send({ error: 'pageId required' });
    if (!body.pageAccessToken?.trim()) return reply.status(400).send({ error: 'pageAccessToken required' });

    // Verify token works trước khi save — call Graph API /me
    try {
      const verifyRes = await fetch(
        `https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(body.pageAccessToken)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!verifyRes.ok) {
        const txt = await verifyRes.text();
        return reply.status(400).send({ error: `Token không hợp lệ: ${txt.slice(0, 200)}` });
      }
      const meData = (await verifyRes.json()) as { id?: string; name?: string };
      if (meData.id !== body.pageId) {
        return reply.status(400).send({ error: `Token này thuộc page ${meData.id} (${meData.name}), không match pageId anh gõ` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: `Không gọi được Graph API: ${msg}` });
    }

    // Check existing connection (1 page chỉ thuộc 1 org)
    const existing = await prisma.facebookPageAccount.findUnique({ where: { pageId: body.pageId } });
    if (existing && existing.orgId !== user.orgId) {
      return reply.status(409).send({ error: `Page ${body.pageId} đã được org khác kết nối` });
    }

    const encrypted = encryptToken(body.pageAccessToken);
    const verifyToken = existing?.webhookVerifyToken ?? generateWebhookVerifyToken();

    if (existing) {
      await prisma.facebookPageAccount.update({
        where: { id: existing.id },
        data: {
          pageName: body.pageName ?? existing.pageName,
          encryptedAccessToken: encrypted,
          isActive: true,
        },
      });
      logger.info(`[fb-oauth] Updated page ${body.pageId} for org ${user.orgId}`);
    } else {
      await prisma.facebookPageAccount.create({
        data: {
          orgId: user.orgId,
          pageId: body.pageId,
          pageName: body.pageName ?? null,
          encryptedAccessToken: encrypted,
          webhookVerifyToken: verifyToken,
          connectedByUserId: user.id,
        },
      });
      logger.info(`[fb-oauth] Connected page ${body.pageId} for org ${user.orgId}`);
    }

    return reply.send({
      success: true,
      pageId: body.pageId,
      webhookVerifyToken: verifyToken,
      webhookUrl: `${request.protocol}://${request.host}/api/v1/webhooks/fb-leadads`,
      instructions: 'Paste webhook URL + verify_token vào Meta App Webhooks config',
    });
  });

  // ── GET /status — list connected pages ───────────────────────────────────
  app.get('/api/v1/integrations/facebook/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const pages = await prisma.facebookPageAccount.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true, pageId: true, pageName: true, isActive: true,
        subscribedAt: true, lastWebhookAt: true, webhookVerifyToken: true,
      },
      orderBy: { subscribedAt: 'desc' },
    });

    // Stats: lead count 24h qua source=fb-leadads
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [received, processed, failed, unroutedListCount] = await Promise.all([
      prisma.webhookLog.count({ where: { orgId: user.orgId, source: 'fb-leadads', createdAt: { gte: since } } }),
      prisma.webhookLog.count({ where: { orgId: user.orgId, source: 'fb-leadads', status: 'processed', createdAt: { gte: since } } }),
      prisma.webhookLog.count({ where: { orgId: user.orgId, source: 'fb-leadads', status: 'failed', createdAt: { gte: since } } }),
      prisma.customerListEntry.count({
        where: {
          createdAt: { gte: since },
          customerList: { orgId: user.orgId, integrationKey: '__UNROUTED__' },
        },
      }),
    ]);

    return {
      pages: pages.map((p) => ({
        ...p,
        // Don't expose verify_token in list view by default
        webhookVerifyToken: undefined,
      })),
      stats24h: {
        received,
        processed,
        failed,
        unrouted: unroutedListCount,
      },
      webhookUrl: `${request.protocol}://${request.host}/api/v1/webhooks/fb-leadads`,
    };
  });

  // ── DELETE /:id — disconnect page ────────────────────────────────────────
  app.delete('/api/v1/integrations/facebook/:id', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const page = await prisma.facebookPageAccount.findFirst({ where: { id, orgId: user.orgId } });
    if (!page) return reply.status(404).send({ error: 'Page not found' });
    await prisma.facebookPageAccount.delete({ where: { id } });
    logger.info(`[fb-oauth] Disconnected page ${page.pageId} from org ${user.orgId}`);
    return reply.send({ success: true });
  });

  // ── GET /:id/verify-token — reveal verify_token (anh paste vào Meta) ─────
  app.get('/api/v1/integrations/facebook/:id/verify-token', { preHandler: requireGrant('settings', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const page = await prisma.facebookPageAccount.findFirst({
      where: { id, orgId: user.orgId },
      select: { webhookVerifyToken: true },
    });
    if (!page) return reply.status(404).send({ error: 'Page not found' });
    return { webhookVerifyToken: page.webhookVerifyToken };
  });

  // ── POST /:id/rotate-verify-token ────────────────────────────────────────
  app.post('/api/v1/integrations/facebook/:id/rotate-verify-token', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const page = await prisma.facebookPageAccount.findFirst({ where: { id, orgId: user.orgId } });
    if (!page) return reply.status(404).send({ error: 'Page not found' });
    const newToken = generateWebhookVerifyToken();
    await prisma.facebookPageAccount.update({
      where: { id },
      data: { webhookVerifyToken: newToken },
    });
    return { webhookVerifyToken: newToken };
  });

  // ── Phase FB Pull 2026-05-30 — System User token + bật kéo lead tự động ──────
  // POST /system-user-token — paste System User token (vĩnh viễn, quyền leads_retrieval).
  // Verify token đọc được lead trước khi lưu (gọi debug_token / me).
  app.post('/api/v1/integrations/facebook/system-user-token', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = request.body as { token?: string; enabled?: boolean };
    if (!body.token?.trim()) return reply.status(400).send({ error: 'token bắt buộc' });

    // Verify token là System User token + lấy user_id (audit)
    let suId: string | null = null;
    try {
      const meRes = await fetch(
        `https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(body.token)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!meRes.ok) {
        const txt = await meRes.text();
        return reply.status(400).send({ error: `Token không hợp lệ: ${txt.slice(0, 200)}` });
      }
      const meData = (await meRes.json()) as { id?: string };
      suId = meData.id ?? null;
    } catch (err) {
      return reply.status(400).send({ error: `Không gọi được Graph API: ${(err as Error).message}` });
    }

    await prisma.organization.update({
      where: { id: user.orgId },
      data: {
        encryptedFbSystemUserToken: encryptToken(body.token),
        fbSystemUserId: suId,
        fbPullEnabled: body.enabled ?? true,
      },
    });
    logger.info(`[fb-oauth] Org ${user.orgId} lưu System User token (suId=${suId}), pull=${body.enabled ?? true}`);
    return { success: true, fbSystemUserId: suId, fbPullEnabled: body.enabled ?? true };
  });

  // PATCH /pull-config — bật/tắt kéo tự động
  app.patch('/api/v1/integrations/facebook/pull-config', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = request.body as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') return reply.status(400).send({ error: 'enabled (boolean) bắt buộc' });
    await prisma.organization.update({ where: { id: user.orgId }, data: { fbPullEnabled: body.enabled } });
    return { fbPullEnabled: body.enabled };
  });

  // GET /pull-status — trạng thái kéo + danh sách form + checkpoint
  app.get('/api/v1/integrations/facebook/pull-status', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const org = await prisma.organization.findUnique({
      where: { id: user.orgId },
      select: { fbPullEnabled: true, fbSystemUserId: true, encryptedFbSystemUserToken: true },
    });
    const forms = await prisma.facebookLeadgenForm.findMany({
      where: { orgId: user.orgId, status: { not: 'deleted' } },
      select: {
        id: true, formId: true, formName: true, status: true,
        lastPullAt: true, lastPullLeadCount: true, lastPullError: true,
        historyBackfilled: true, consecutiveErrors: true,
      },
      orderBy: { lastPullAt: 'desc' },
    });
    return {
      fbPullEnabled: org?.fbPullEnabled ?? false,
      hasSystemUserToken: !!org?.encryptedFbSystemUserToken,
      fbSystemUserId: org?.fbSystemUserId ?? null,
      forms,
    };
  });
}

/** Test decrypt — used by admin debug endpoint hoặc test. KHÔNG expose qua API. */
export function testDecryptToken(encryptedBlob: string): string {
  return decryptToken(encryptedBlob);
}
