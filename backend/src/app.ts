/**
 * Main application entry point.
 * Bootstraps Fastify server with all plugins, Socket.IO, and route handlers.
 * The process never exits — all errors are caught and logged.
 */

// BigInt → string khi JSON.stringify (Fastify response serializer).
// Cần thiết cho Message.zaloMsgIdNum (Prisma trả BigInt, JSON native fail without this).
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';
import { config } from './config/index.js';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import { brandingRoutes } from './modules/branding/branding-routes.js';
import { zaloRoutes } from './modules/zalo/zalo-routes.js';
import { chatRoutes } from './modules/chat/chat-routes.js';
import { folderRoutes } from './modules/chat/folder-routes.js';
import { presetRoutes } from './modules/chat/preset-routes.js';
import { chatAttachmentRoutes } from './modules/chat/chat-attachment-routes.js';
import { contactRoutes } from './modules/contacts/contact-routes.js';
import { statusRoutes } from './modules/contacts/status-routes.js';
import { contactSubResourceRoutes } from './modules/contacts/contact-sub-resource-routes.js';
import { appointmentRoutes } from './modules/contacts/appointment-routes.js';
import { notesRoutes } from './modules/contacts/notes-routes.js';
import { startInteractionCron } from './modules/contacts/interaction-cron.js';
import { crmTagRoutes } from './modules/contacts/crm-tag-routes.js';
import { crmTagGroupRoutes } from './modules/contacts/crm-tag-group-routes.js';
import { userPreferenceRoutes } from './modules/auth/user-preference-routes.js';
import { timelineRoutes } from './modules/activity/timeline-routes.js';
import { scoringRoutes } from './modules/scoring/scoring-routes.js';
import { zaloLabelsRoutes, startLabelsBackgroundSync } from './modules/zalo/zalo-labels-routes.js';
import { startAppointmentReminder } from './modules/contacts/appointment-reminder.js';
import { zinstantProxyRoutes } from './modules/contacts/zinstant-proxy-routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard-routes.js';
import { reportRoutes } from './modules/dashboard/report-routes.js';
import { userRoutes } from './modules/auth/user-routes.js';
import { teamRoutes } from './modules/auth/team-routes.js';
import { orgRoutes } from './modules/auth/org-routes.js';
import { zaloAccessRoutes } from './modules/zalo/zalo-access-routes.js';
import { zaloSyncRoutes } from './modules/zalo/zalo-sync-routes.js';
import { zaloDashboardRoutes } from './modules/zalo/zalo-dashboard-routes.js';
import { zaloPool } from './modules/zalo/zalo-pool.js';
import { registerZaloSocketHandlers } from './modules/zalo/zalo-socket.js';
import { notificationRoutes } from './modules/notifications/notification-routes.js';
import { searchRoutes } from './modules/search/search-routes.js';
import { startZaloHealthCheck } from './modules/zalo/zalo-health-check.js';
import { publicApiRoutes } from './modules/api/public-api-routes.js';
import { webhookSettingsRoutes } from './modules/api/webhook-settings-routes.js';
import { startContactIntelligence } from './modules/contacts/contact-intelligence.js';
import { analyticsRoutes } from './modules/analytics/analytics-routes.js';
import { savedReportRoutes } from './modules/analytics/saved-report-routes.js';
import { integrationRoutes } from './modules/integrations/integration-routes.js';
import { facebookRoutes } from './modules/integrations/providers/facebook/facebook-routes.js';
import { automationRoutes } from './modules/automation/automation-routes.js';
import { templateRoutes } from './modules/automation/template-routes.js';
// Phase 7 — Automation framework (Block / Sequence / Trigger / Broadcast)
import { blockRoutes } from './modules/automation/blocks/block-routes.js';
import { blockFolderRoutes } from './modules/automation/blocks/block-folder-routes.js';
import { sequenceRoutes } from './modules/automation/sequences/sequence-routes.js';
import { triggerRoutes } from './modules/automation/triggers/trigger-routes.js';
import { broadcastRoutes } from './modules/automation/broadcasts/broadcast-routes.js';
import { webhookRoutes as automationWebhookRoutes } from './modules/automation/webhooks/webhook-routes.js';
// Tệp khách hàng (CustomerList) — Phase 7 audience layer
import { customerListRoutes } from './modules/automation/lists/list-routes.js';
import { customerListEntryRoutes } from './modules/automation/lists/list-entry-routes.js';
import { startListEnrichmentWorker } from './modules/automation/lists/list-enrichment-service.js';
import { registerCustomerListEventHandlers } from './modules/automation/lists/list-event-handlers.js';
import { aiRoutes } from './modules/ai/ai-routes.js';
import { chatOperationsRoutes, registerChatSocketHandlers } from './modules/chat/chat-operations-routes.js';
import { groupRoutes } from './modules/zalo/group-routes.js';
import { groupModerationRoutes } from './modules/zalo/group-moderation-routes.js';
import { friendRoutes } from './modules/zalo/friend-routes.js';
import { profileRoutes } from './modules/zalo/profile-routes.js';
import { credentialRoutes } from './modules/zalo/credential-routes.js';
import { eventBuffer } from './shared/event-buffer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  const app = Fastify({ logger: false });

  // ── Plugins ──────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: config.isProduction ? config.appUrl : true,
    credentials: true,
  });

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
  });

  await app.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
    // Skip rate limiting for static assets — only limit API routes
    allowList: (request: { url: string }) => !request.url.startsWith('/api/'),
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB — video cap; per-kind size enforced in route
      files: 10,
    },
  });

  // Serve compiled frontend assets in production
  if (config.isProduction) {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, '../static'),
      prefix: '/',
    });
  }

  // ── Socket.IO ─────────────────────────────────────────────────────────────

  const io = new Server(app.server, {
    cors: {
      origin: config.isProduction ? config.appUrl : '*',
      credentials: true,
    },
  });

  // Attach io to app so route handlers can emit events
  app.decorate('io', io);

  // Pass io to zalo pool for real-time event emission
  zaloPool.setIO(io);

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);
    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  // Register Zalo Socket.IO event handlers
  registerZaloSocketHandlers(io);

  // Register chat Socket.IO event handlers
  registerChatSocketHandlers(io);

  // ── Routes ────────────────────────────────────────────────────────────────

  await app.register(authRoutes);
  await app.register(brandingRoutes);
  await app.register(zaloRoutes);
  await app.register(chatRoutes);
  await app.register(folderRoutes);
  await app.register(presetRoutes);
  await app.register(chatAttachmentRoutes);
  await app.register(contactRoutes);
  await app.register(statusRoutes);
  await app.register(contactSubResourceRoutes);
  await app.register(appointmentRoutes);
  await app.register(notesRoutes);
  await app.register(crmTagRoutes);
  await app.register(crmTagGroupRoutes);
  await app.register(userPreferenceRoutes);
  await app.register(timelineRoutes);
  await app.register(scoringRoutes);
  // Phase 8 — Engagement heatmap timeline + admin recompute/backfill
  const { registerEngagementRoutes } = await import('./modules/engagement/engagement-routes.js');
  await registerEngagementRoutes(app);
  // RBAC Phase Phân Quyền 2026-05-21 — Department + PermissionGroup (M2 Getfly Clone)
  const { registerDepartmentRoutes } = await import('./modules/rbac/department-routes.js');
  await registerDepartmentRoutes(app);
  const { registerPermissionGroupRoutes } = await import('./modules/rbac/permission-group-routes.js');
  await registerPermissionGroupRoutes(app);
  const { registerUserAssignmentRoutes } = await import('./modules/rbac/user-assignment-routes.js');
  await registerUserAssignmentRoutes(app);
  // Phase Riêng Tư 2026-05-22 — PIN-gated visual privacy
  const { registerPrivacyRoutes } = await import('./modules/privacy/privacy-routes.js');
  await registerPrivacyRoutes(app);
  await app.register(zaloLabelsRoutes);
  await app.register(zinstantProxyRoutes);
  await app.register(dashboardRoutes);
  await app.register(reportRoutes);
  await app.register(userRoutes);
  await app.register(teamRoutes);
  await app.register(orgRoutes);
  await app.register(zaloAccessRoutes);
  await app.register(zaloSyncRoutes);
  await app.register(zaloDashboardRoutes);
  await app.register(notificationRoutes);
  await app.register(searchRoutes);
  await app.register(publicApiRoutes);
  await app.register(webhookSettingsRoutes);
  await app.register(analyticsRoutes);
  await app.register(savedReportRoutes);
  await app.register(integrationRoutes);
  await app.register(facebookRoutes);
  await app.register(automationRoutes);
  await app.register(templateRoutes);
  // Phase 7 — Block authoring layer (must register BEFORE sequence/trigger/broadcast in later phases)
  await app.register(blockRoutes);
  await app.register(blockFolderRoutes);
  await app.register(sequenceRoutes);
  await app.register(triggerRoutes);
  await app.register(broadcastRoutes);
  await app.register(automationWebhookRoutes);
  // Tệp khách hàng — CustomerList CRUD + entries + enrichment + event handlers
  await app.register(customerListRoutes);
  await app.register(customerListEntryRoutes);
  await app.register(aiRoutes);
  await app.register(chatOperationsRoutes);
  await app.register(groupRoutes);
  await app.register(groupModerationRoutes);
  await app.register(friendRoutes);
  await app.register(profileRoutes);
  await app.register(credentialRoutes);

  // Liveness/readiness probe — also checks DB connectivity
  app.get('/health', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'error', db: 'disconnected', timestamp: new Date().toISOString() };
    }
  });

  // API version banner
  app.get('/api/v1/status', async () => {
    return { version: '1.0.0', name: 'Zalo CRM' };
  });

  // SPA fallback — serve index.html for non-API routes in production
  if (config.isProduction) {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // ── Error handler ─────────────────────────────────────────────────────────

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    logger.error('Request error:', error.message);
    reply.status(error.statusCode ?? 500).send({
      error: error.message || 'Internal Server Error',
    });
  });

  // ── Start ─────────────────────────────────────────────────────────────────

  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(`Zalo CRM running on http://${config.host}:${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    startAppointmentReminder(io);
    startZaloHealthCheck();
    startContactIntelligence();
    startLabelsBackgroundSync(60_000); // realtime-ish 2-way pull every 60s
    startInteractionCron(); // daily silent_30d detection (02:00 VN)
    // Phase 8 — Engagement heatmap classification (02:30 VN daily)
    const { startEngagementCron } = await import('./modules/engagement/engagement-cron.js');
    startEngagementCron();
    // Phase A — Real-time Zalo presence cache + bulk refresh 60s + socket emit
    const { startPresenceCron } = await import('./modules/zalo/presence-service.js');
    startPresenceCron(io);
    // Friend full-sync periodic (*/15 min) — catch alias/name/avatar drift từ Zalo
    // native app mà friend_event listener không bắt được (xem friend-sync-cron.ts)
    const { startFriendSyncCron } = await import('./modules/zalo/friend-sync-cron.js');
    startFriendSyncCron(io);
    // Phase ZaloAccounts redesign 2026-05-22 — status log: backfill open records 1
    // lần lúc startup (idempotent), rồi start checkpoint cron (*/5 min) reconcile
    // orphan records sau crash. Uptime accuracy = 5p resolution.
    const { backfillStatusLog } = await import('./modules/zalo/status-log-backfill.js');
    backfillStatusLog().catch((err) => logger.error('[status-log-backfill] failed:', err));
    const { startStatusLogCheckpointCron } = await import('./modules/zalo/status-log-checkpoint-cron.js');
    startStatusLogCheckpointCron();
    // Phase 6 — Lead Scoring background jobs (decay hourly + stuck detection 6am daily)
    const { startScoringScheduler } = await import('./modules/scoring/scoring-scheduler.js');
    startScoringScheduler({ enabled: config.nodeEnv !== 'test' });
    await eventBuffer.start(io);
    // Phase 7 — Automation engine (event bus + materializer + task worker + 3 action handlers)
    if (config.nodeEnv !== 'test') {
      const { startAutomationEngine } = await import('./modules/automation/engine/index.js');
      startAutomationEngine();
      // Phase F — Broadcast scheduler: poll automation_broadcasts scheduled→running
      const { startBroadcastScheduler } = await import('./modules/automation/broadcasts/broadcast-scheduler.js');
      startBroadcastScheduler();
      // Tệp khách hàng — enrichment worker + reverse-update event handlers
      startListEnrichmentWorker();
      registerCustomerListEventHandlers();
      // FB Lead Ingestion — BullMQ worker (Phase 04)
      const { startFacebookLeadIngestionWorker } = await import('./modules/integrations/providers/facebook/facebook-lead-worker.js');
      void startFacebookLeadIngestionWorker();
      // FB Form Discovery — BullMQ worker (Phase FB-11)
      const { startFormDiscoveryWorker } = await import('./modules/integrations/providers/facebook/facebook-form-discovery-worker.js');
      void startFormDiscoveryWorker();
      // FB Page Token refresh — daily cron @ 03:00 (Phase 06)
      const { startFacebookTokenRefreshCron } = await import('./modules/integrations/providers/facebook/facebook-token-refresh-cron.js');
      startFacebookTokenRefreshCron();
    }
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }

  // Reconnect Zalo accounts that have saved sessions
  try {
    const accounts = await prisma.zaloAccount.findMany({
      where: { sessionData: { not: Prisma.JsonNull }, archivedAt: null, status: { not: 'disconnected' } },
      select: { id: true, sessionData: true },
    });
    logger.info(`Attempting reconnect for ${accounts.length} Zalo account(s)`);
    for (const account of accounts) {
      const session = account.sessionData as {
        cookie: any;
        imei: string;
        userAgent: string;
      } | null;
      if (session?.imei) {
        zaloPool.reconnect(account.id, session).catch((err) => {
          logger.warn(`Auto-reconnect failed for account ${account.id}:`, err);
        });
      }
    }
  } catch (err) {
    logger.error('Failed to load accounts for reconnect:', err);
  }
}

// Keep process alive — log but never crash on unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

bootstrap();
