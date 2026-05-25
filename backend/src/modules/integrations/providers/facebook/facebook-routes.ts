/**
 * facebook-routes.ts — Fastify plugin for all Facebook integration endpoints.
 *
 * Routes registered under /api/v1/integrations/facebook:
 *   POST /oauth/start                      — get Meta OAuth dialog URL
 *   GET  /oauth/callback                   — Meta redirects back here with code
 *   GET  /webhook                          — Meta webhook verification challenge
 *   POST /webhook                          — Meta webhook lead events (raw body HMAC)
 *   GET  /pages                            — list connected pages for org
 *   POST /pages/:pageId/disconnect         — disconnect a page
 *   POST /pages/:pageId/rediscover         — manually trigger form discovery for a page
 *   GET  /mappings                         — list form mappings with lead stats (read-only)
 *   POST /admin/refresh-tokens             — manual trigger token refresh for org (admin only)
 *
 * REMOVED (FB-11 auto-discovery replaces manual mapping flow):
 *   POST /mappings, PUT /mappings/:id, DELETE /mappings/:id
 *   GET  /pages/:pageId/forms
 *   GET/PUT /customer-lists/:listId/sale-assignments
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../../auth/auth-middleware.js';
import { requireRole } from '../../../auth/role-middleware.js';
import { logger } from '../../../../shared/utils/logger.js';
import { prisma } from '../../../../shared/database/prisma-client.js';
import {
  verifyChallenge,
  verifySignature,
  extractLeadgenEvents,
  enqueueAll,
} from './facebook-webhook-service.js';
import {
  buildAuthUrl,
  generateState,
  verifyState,
  handleCallback,
  disconnectPage,
} from './facebook-oauth-service.js';
import { runRefreshForOrg } from './facebook-token-refresh-cron.js';
import { enqueueFormDiscovery } from './facebook-form-discovery-worker.js';

const PREFIX = '/api/v1/integrations/facebook';
const FRONTEND_FB_PATH = '/settings/channels/facebook';

export async function facebookRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /oauth/start ────────────────────────────────────────────────────
  // Generates CSRF state and returns Meta OAuth URL as JSON.
  // Frontend calls this with auth header, then redirects browser to data.url.
  // POST (not GET) to avoid browser-prefetch + ensure axios sends Authorization header.
  app.post(
    `${PREFIX}/oauth/start`,
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const state = generateState(orgId);
        const authUrl = buildAuthUrl(orgId, state);
        return reply.send({ url: authUrl });
      } catch (err) {
        logger.error('[fb-routes] OAuth start error:', err);
        return reply.status(500).send({ error: 'Failed to initiate Facebook OAuth' });
      }
    },
  );

  // ── GET /oauth/callback ───────────────────────────────────────────────────
  // Meta redirects here. Verify state, exchange code, persist pages.
  // No auth middleware — state param carries the orgId signed with FB_APP_SECRET.
  app.get(
    `${PREFIX}/oauth/callback`,
    async (
      request: FastifyRequest<{
        Querystring: { code?: string; state?: string; error?: string; error_reason?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { code, state, error, error_reason } = request.query;
      const frontendBase = `${process.env.APP_URL ?? ''}${FRONTEND_FB_PATH}`;

      // User denied permissions
      if (error) {
        logger.warn('[fb-routes] OAuth denied: %s %s', error, error_reason);
        return reply.redirect(`${frontendBase}?status=error&reason=${encodeURIComponent(error_reason ?? error)}`, 302);
      }

      if (!code || !state) {
        return reply.redirect(`${frontendBase}?status=error&reason=missing_params`, 302);
      }

      // CSRF check
      const orgId = verifyState(state);
      if (!orgId) {
        logger.warn('[fb-routes] Invalid OAuth state received');
        return reply.redirect(`${frontendBase}?status=error&reason=invalid_state`, 302);
      }

      try {
        const { connectedPages } = await handleCallback(code, orgId);
        return reply.redirect(`${frontendBase}?status=success&pages=${connectedPages}`, 302);
      } catch (err) {
        logger.error('[fb-routes] OAuth callback error for org %s:', orgId, err);
        const reason = encodeURIComponent((err as Error).message.slice(0, 100));
        return reply.redirect(`${frontendBase}?status=error&reason=${reason}`, 302);
      }
    },
  );

  // ── GET /webhook ─────────────────────────────────────────────────────────
  // Meta webhook verification challenge — must return hub.challenge as plain text.
  // NO auth — Meta calls this directly.
  app.get(
    `${PREFIX}/webhook`,
    async (
      request: FastifyRequest<{
        Querystring: {
          'hub.mode'?: string;
          'hub.verify_token'?: string;
          'hub.challenge'?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const challenge = verifyChallenge(request.query);
      if (!challenge) {
        logger.warn('[fb-routes] Webhook challenge failed — invalid verify_token or mode');
        return reply.status(403).send('Forbidden');
      }
      return reply.type('text/plain').send(challenge);
    },
  );

  // ── POST /webhook ─────────────────────────────────────────────────────────
  // Meta webhook lead events. Must:
  //   1. Read raw body for HMAC (scoped content-type parser, buffer mode)
  //   2. Verify HMAC before any parsing
  //   3. Enqueue events and return 200 in < 500ms
  // NO auth — verified by HMAC.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 1_048_576 }, // 1 MB limit
    (req, body: Buffer, done) => {
      // Only intercept the webhook POST — other routes still use default JSON parser.
      // Fastify picks the most-specific match; we attach rawBody to request for
      // HMAC verify, then parse JSON ourselves.
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post(
    `${PREFIX}/webhook`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Respond fast — enqueue only, never process inline
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
      const sig = request.headers['x-hub-signature-256'] as string | undefined;

      if (!rawBody) {
        logger.warn('[fb-routes] Webhook POST: missing raw body');
        return reply.status(400).send({ error: 'bad_request' });
      }

      if (!verifySignature(rawBody, sig)) {
        logger.warn('[fb-routes] Webhook POST: HMAC verification failed');
        return reply.status(401).send({ error: 'invalid_signature' });
      }

      const events = extractLeadgenEvents(request.body);
      // Fire-and-forget enqueue — do NOT await to keep latency < 500ms
      enqueueAll(events).catch((err) =>
        logger.error('[fb-routes] Enqueue error:', err),
      );

      return reply.status(200).send({ ok: true });
    },
  );

  // ── GET /pages ────────────────────────────────────────────────────────────
  // List connected Facebook pages for the current org.
  app.get(
    `${PREFIX}/pages`,
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const pages = await prisma.facebookPageConnection.findMany({
          where: { orgId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            pageId: true,
            pageName: true,
            status: true,
            subscribedAt: true,
            tokenExpiresAt: true,
            lastError: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Enrich each page with last lead event time
        const enriched = await Promise.all(
          pages.map(async (p) => {
            const lastEvent = await prisma.facebookLeadEvent.findFirst({
              where: { orgId, pageId: p.pageId },
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            });
            return { ...p, lastLeadAt: lastEvent?.createdAt ?? null };
          }),
        );

        return enriched;
      } catch (err) {
        logger.error('[fb-routes] GET pages error:', err);
        return reply.status(500).send({ error: 'Failed to fetch Facebook pages' });
      }
    },
  );

  // ── POST /pages/:pageId/disconnect ────────────────────────────────────────
  // Disconnect a page: wipe token, set status=revoked, call FB unsubscribe.
  // Admin+ only.
  app.post(
    `${PREFIX}/pages/:pageId/disconnect`,
    { preHandler: [authMiddleware, requireRole('owner', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const { pageId } = request.params as { pageId: string };

        // Count active mappings before disconnect (for UI warning)
        const activeMappings = await prisma.facebookFormMapping.count({
          where: {
            orgId,
            pageConnection: { pageId },
            enabled: true,
          },
        });

        await disconnectPage(orgId, pageId);
        return { success: true, disabledMappings: activeMappings };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('not found')) {
          return reply.status(404).send({ error: 'Page connection not found' });
        }
        logger.error('[fb-routes] Disconnect page error:', err);
        return reply.status(500).send({ error: 'Failed to disconnect page' });
      }
    },
  );

  // ── GET /mappings ─────────────────────────────────────────────────────────
  // List all FacebookFormMapping for current org (read-only, auto-populated by discovery).
  // Returns enriched DTOs: customerListName, leadCount, lastLeadAt.
  app.get(
    `${PREFIX}/mappings`,
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const mappings = await prisma.facebookFormMapping.findMany({
          where: { orgId },
          orderBy: { createdAt: 'desc' },
          include: {
            pageConnection: {
              select: { pageId: true, pageName: true, status: true },
            },
            customerList: {
              select: { id: true, name: true, iconEmoji: true },
            },
          },
        });

        // Enrich with lead counts
        const formIds = mappings.map((m) => m.formId);
        const leadStats = await prisma.facebookLeadEvent.groupBy({
          by: ['formId'],
          where: { formId: { in: formIds }, processedAt: { not: null } },
          _count: { id: true },
          _max: { processedAt: true },
        });
        const statsByFormId = new Map(
          leadStats.map((s) => [s.formId, { count: s._count.id, lastLeadAt: s._max.processedAt }]),
        );

        return mappings.map((m) => {
          const stat = statsByFormId.get(m.formId);
          return {
            ...m,
            customerListName: m.customerList?.name ?? null,
            leadCount: stat?.count ?? 0,
            lastLeadAt: stat?.lastLeadAt ?? null,
          };
        });
      } catch (err) {
        logger.error('[fb-routes] GET mappings error:', err);
        return reply.status(500).send({ error: 'Failed to fetch mappings' });
      }
    },
  );

  // ── POST /pages/:pageId/rediscover ────────────────────────────────────────
  // Manually trigger form discovery for a connected page.
  // Returns 202 with jobId. Admin+ only.
  app.post<{ Params: { pageId: string } }>(
    `${PREFIX}/pages/:pageId/rediscover`,
    { preHandler: [authMiddleware, requireRole('owner', 'admin')] },
    async (request, reply) => {
      try {
        const { orgId } = request.user!;
        const { pageId } = request.params;

        const conn = await prisma.facebookPageConnection.findFirst({
          where: { orgId, pageId },
          select: { id: true, status: true },
        });
        if (!conn) {
          return reply.status(404).send({ error: 'Page connection not found' });
        }
        if (conn.status !== 'connected') {
          return reply.status(400).send({ error: 'Page is not connected — reconnect first' });
        }

        const jobId = await enqueueFormDiscovery({ orgId, pageConnectionId: conn.id, pageId });
        return reply.status(202).send({ jobId: jobId ?? null, message: 'Discovery job enqueued' });
      } catch (err) {
        logger.error('[fb-routes] POST rediscover error:', err);
        return reply.status(500).send({ error: 'Failed to enqueue discovery' });
      }
    },
  );

  // ── POST /admin/refresh-tokens ────────────────────────────────────────────
  // Manual trigger: refresh tokens for all connected pages in current org.
  // Ops debugging only — requires admin+ role.
  app.post(
    `${PREFIX}/admin/refresh-tokens`,
    { preHandler: [authMiddleware, requireRole('owner', 'admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        logger.info('[fb-routes] Manual token refresh triggered for org %s', orgId);
        const summary = await runRefreshForOrg(orgId);
        return summary;
      } catch (err) {
        logger.error('[fb-routes] Manual refresh-tokens error:', err);
        return reply.status(500).send({ error: 'Token refresh failed' });
      }
    },
  );
}
