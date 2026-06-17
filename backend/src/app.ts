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

import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyFormbody from '@fastify/formbody';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma } from '@prisma/client';
import { config } from './config/index.js';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';
import { authRoutes } from './modules/auth/auth-routes.js';
import { brandingRoutes } from './modules/branding/branding-routes.js';
import { orgBrandingRoutes } from './modules/branding/org-branding-routes.js';
import { zaloRoutes } from './modules/zalo/zalo-routes.js';
import { chatRoutes } from './modules/chat/chat-routes.js';
import { folderRoutes } from './modules/chat/folder-routes.js';
import { presetRoutes } from './modules/chat/preset-routes.js';
import { chatAttachmentRoutes } from './modules/chat/chat-attachment-routes.js';
import { mediaRoutes } from './modules/media/media-routes.js';
import { contactRoutes } from './modules/contacts/contact-routes.js';
import { statusRoutes } from './modules/contacts/status-routes.js';
import { contactSubResourceRoutes } from './modules/contacts/contact-sub-resource-routes.js';
import { cockpitRoutes } from './modules/contacts/cockpit-routes.js';
import { appointmentRoutes } from './modules/contacts/appointment-routes.js';
import { appointmentPublicRoutes } from './modules/contacts/appointment-public-routes.js';
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
import { dashboardActionHubRoutes } from './modules/dashboard/dashboard-action-hub-routes.js';
import { reportRoutes } from './modules/dashboard/report-routes.js';
import { reportAnalyticsRoutes } from './modules/dashboard/report-analytics-routes.js';
import { userRoutes } from './modules/auth/user-routes.js';
import { teamRoutes } from './modules/auth/team-routes.js';
import { orgRoutes } from './modules/auth/org-routes.js';
import { zaloAccessRoutes } from './modules/zalo/zalo-access-routes.js';
import { zaloSyncRoutes } from './modules/zalo/zalo-sync-routes.js';
import { zaloDashboardRoutes } from './modules/zalo/zalo-dashboard-routes.js';
import { zaloPool } from './modules/zalo/zalo-pool.js';
import { registerZaloSocketHandlers } from './modules/zalo/zalo-socket.js';
import { registerSocketAuth } from './shared/realtime/socket-auth.js';
import { registerPrivacyLeakGuard } from './modules/privacy/privacy-leak-guard.js';
import { registerSecurityHeaders } from './shared/security/security-headers.js';
import { notificationRoutes } from './modules/notifications/notification-routes.js';
import { searchRoutes } from './modules/search/search-routes.js';
import { startZaloHealthCheck } from './modules/zalo/zalo-health-check.js';
import { publicApiRoutes } from './modules/api/public-api-routes.js';
import { webhookSettingsRoutes } from './modules/api/webhook-settings-routes.js';
import { startContactIntelligence } from './modules/contacts/contact-intelligence.js';
import { analyticsRoutes } from './modules/analytics/analytics-routes.js';
import { savedReportRoutes } from './modules/analytics/saved-report-routes.js';
import { integrationRoutes } from './modules/integrations/integration-routes.js';
import { automationRoutes } from './modules/automation/automation-routes.js';
import { templateRoutes } from './modules/automation/template-routes.js';
import { templateFolderRoutes } from './modules/automation/template-folder-routes.js';
// Phase 7 — Automation framework (Block / Sequence / Trigger / Broadcast)
import { blockRoutes } from './modules/automation/blocks/block-routes.js';
import { blockFolderRoutes } from './modules/automation/blocks/block-folder-routes.js';
import { sequenceRoutes } from './modules/automation/sequences/sequence-routes.js';
import { registerSequenceStatsRoutes } from './modules/automation/sequences/stats-routes.js';
import { registerBullBoardRoutes } from './modules/automation/queues/bull-board-routes.js';
import { registerManualControlRoutes } from './modules/automation/queues/manual-control-routes.js';
import { triggerRoutes } from './modules/automation/triggers/trigger-routes.js';
import { friendInviteRoutes } from './modules/automation/friend-invite/friend-invite-routes.js';
import { careSessionRoutes } from './modules/automation/care-session/care-session-routes.js';
import { startFriendInviteSweepers, stopFriendInviteSweepers } from './modules/automation/friend-invite/sweepers.js';
import { startWelcomeProbeWorker, stopWelcomeProbeWorker } from './modules/automation/friend-invite/welcome-probe-worker.js';
import { bootstrapFriendInviteWorkers, stopAllNickWorkers, setNickWorkerIO } from './modules/automation/friend-invite/nick-worker.js';
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
import { systemNotifyRoutes } from './modules/system-notifications/system-notify-routes.js';
import { userCreateWithZaloRoutes } from './modules/system-notifications/user-create-with-zalo-routes.js';
import { leadPoolRoutes } from './modules/lead-pool/lead-pool-routes.js';
import { startLeadPoolCron } from './modules/lead-pool/lead-pool-service.js';
// Phase Multi-Source Lead Ads 2026-05-27 — FB adapter + outbox worker
import { fbLeadAdsRoutes } from './modules/integrations/facebook-leadads/fb-routes.js';
import { fbIntegrationRoutes } from './modules/integrations/facebook-leadads/fb-oauth.js';
import { processFbWebhookLog } from './modules/integrations/facebook-leadads/fb-adapter.js';
import { startOutboxWorker, registerLogProcessor } from './modules/integrations/_shared/outbox-worker.js';
// Phase FB Lead Ads "Form" 2026-06-09 — port từ main: OAuth Page + webhook leadgen + form→list.
import { facebookRoutes } from './modules/integrations/providers/facebook/facebook-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  // trustProxy 2026-06-11 — app chạy sau Cloudflare + reverse proxy (nginx/Caddy).
  // KHÔNG bật → Fastify thấy request.ip = IP proxy DUY NHẤT cho mọi user → rate-limit
  // theo IP biến thành GLOBAL (500/phút CHUNG cho cả công ty) → 20-25 sale thao tác
  // cùng lúc chạm trần ngay → 429 hàng loạt + chat lag. Bật để đọc X-Forwarded-For
  // (IP thật) làm fallback khi request không có token.
  const app = Fastify({ logger: false, trustProxy: true });

  // ── Plugins ──────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: config.isProduction ? config.appUrl : true,
    credentials: true,
  });

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
  });

  // Phase 3 2026-06-08 — security headers (CSP report-only mặc định) cho mọi response.
  registerSecurityHeaders(app);

  // Rate-limit 2026-06-11 — SỬA GỐC: đếm theo TỪNG USER CRM (id trong JWT) thay vì
  // theo IP. Lý do: sau Cloudflare/proxy mọi user chung 1 IP → rate-limit theo IP =
  // GLOBAL (500/phút chia chung cả công ty) → 20-25 sale chạm trần → 429 + chat lag.
  // Mỗi lần mở 1 hội thoại UI bắn ~9-13 request (tin nhắn + nhãn + lead-pool + AI +
  // hồ sơ KH + quan hệ + tags). Đếm PER-USER → mỗi sale có hạn mức riêng, không ảnh
  // hưởng nhau. Token decode rẻ (không +DB). Fallback IP cho request không có token.
  await app.register(rateLimit, {
    max: 1200,                    // /phút/USER — sale active mở ~40 conv/phút × 13 req + tab/panel vẫn dư
    timeWindow: '1 minute',
    // Key theo user CRM (sub=id trong JWT access token). Không có/sai token → theo IP
    // (đã đúng nhờ trustProxy đọc X-Forwarded-For).
    keyGenerator: (request: FastifyRequest) => {
      try {
        const auth = request.headers['authorization'];
        const token = typeof auth === 'string' ? auth.replace(/^Bearer\s+/i, '') : '';
        if (token) {
          const payload = app.jwt.verify<{ id?: string }>(token);
          if (payload?.id) return `u:${payload.id}`;
        }
      } catch {
        // token thiếu/hết hạn/sai → rơi xuống key theo IP
      }
      return `ip:${request.ip}`;
    },
    // Skip rate limiting for static assets — only limit API routes
    allowList: (request: { url: string }) => !request.url.startsWith('/api/'),
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB — video cap; per-kind size enforced in route
      files: 10,
    },
  });

  await app.register(fastifyFormbody);

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

  // Phase 1b 2026-06-07 — Socket.IO auth PHẢI đăng ký TRƯỚC mọi handler:
  // io.use() verify JWT + auto-join org room từ token (vá P0 IDOR cross-tenant WS).
  registerSocketAuth(io, app);

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

  // PRIVACY 2026-06-11 (Đợt 3.1) — guard giám sát rò rỉ: onSend toàn cục, quét
  // response route content/mixed, CẢNH BÁO (không tự sửa) nếu nick main chưa redact.
  // Đăng ký TRƯỚC routes để áp cho mọi route đăng ký sau.
  registerPrivacyLeakGuard(app);

  // ── Routes ────────────────────────────────────────────────────────────────

  await app.register(authRoutes);
  await app.register(brandingRoutes);
  await app.register(orgBrandingRoutes); // public org branding cho trang /login (pre-auth)
  await app.register(zaloRoutes);
  await app.register(chatRoutes);
  await app.register(folderRoutes);
  await app.register(presetRoutes);
  await app.register(chatAttachmentRoutes);
  await app.register(mediaRoutes);
  await app.register(contactRoutes);
  await app.register(statusRoutes);
  await app.register(contactSubResourceRoutes);
  await app.register(cockpitRoutes);
  await app.register(appointmentRoutes);
  await app.register(appointmentPublicRoutes); // 2026-06-16 — public action link (no auth)
  await app.register(notesRoutes);
  await app.register(crmTagRoutes);
  await app.register(crmTagGroupRoutes);
  // Tag Taxonomy v2 — Wave 3 /plan-eng-review M57 2026-05-31
  // Mount 3 prefix: /api/v1/tags (definitions), /api/v1/friends/:id/tags, /api/v1/contacts/:id/crm-tags
  const { registerTagRoutes, registerFriendTagRoutes, registerContactCrmTagRoutes } = await import('./modules/tags/tag-routes.js');
  await app.register(registerTagRoutes, { prefix: '/api/v1/tags' });
  await app.register(registerFriendTagRoutes, { prefix: '/api/v1/friends' });
  await app.register(registerContactCrmTagRoutes, { prefix: '/api/v1/contacts' });
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
  await app.register(dashboardActionHubRoutes);
  await app.register(reportRoutes);
  await app.register(reportAnalyticsRoutes);
  await app.register(userRoutes);
  await app.register(teamRoutes);
  await app.register(orgRoutes);
  await app.register(zaloAccessRoutes);
  await app.register(zaloSyncRoutes);
  await app.register(zaloDashboardRoutes);
  await app.register(notificationRoutes);
  await app.register(systemNotifyRoutes);
  await app.register(userCreateWithZaloRoutes);
  await app.register(leadPoolRoutes);
  // Phase Multi-Source Lead Ads 2026-05-27 — FB Lead Ads webhook + OAuth/status
  await app.register(fbLeadAdsRoutes);
  await app.register(fbIntegrationRoutes);
  // Form ingestion (port từ main) — sub-path /oauth /webhook /pages /mappings (KHÔNG trùng Campaign).
  await app.register(facebookRoutes);
  await app.register(searchRoutes);
  await app.register(publicApiRoutes);
  await app.register(webhookSettingsRoutes);
  await app.register(analyticsRoutes);
  await app.register(savedReportRoutes);
  await app.register(integrationRoutes);
  await app.register(automationRoutes);
  await app.register(templateRoutes);
  await app.register(templateFolderRoutes);
  // Phase 7 — Block authoring layer (must register BEFORE sequence/trigger/broadcast in later phases)
  await app.register(blockRoutes);
  await app.register(blockFolderRoutes);
  await app.register(sequenceRoutes);
  // Luồng Mục Tiêu M6 Stats Wave A
  await registerSequenceStatsRoutes(app);
  // Luồng Mục Tiêu M7 Bull Board admin UI
  await registerBullBoardRoutes(app);
  // Luồng Mục Tiêu M9 manual control endpoints
  await registerManualControlRoutes(app);
  await app.register(triggerRoutes);
  await app.register(friendInviteRoutes);
  // CareSession (Phiên chăm sóc) 2026-06-07 — list/detail/close phiên
  await app.register(careSessionRoutes);
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
    // Contact profile enrichment (3am daily) — kéo gender + ngày sinh KH từ Zalo getUserInfo
    // cho KH đang trống. 24h/lần để tránh rate-limit (Anh chốt 2026-06-06).
    if (config.nodeEnv !== 'test') {
      const { startContactProfileSyncCron } = await import('./modules/contacts/contact-profile-sync-cron.js');
      startContactProfileSyncCron();
    }
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
    // Tag Taxonomy v2 — Wave 3 /plan-eng-review M57 (Issue 6A)
    // Cron 5 phút batch UPDATE Contact.autoTags từ Redis dirty set.
    // Wave 5 Slim drop Contact.autoTags → bỏ luôn cron.
    if (config.nodeEnv !== 'test') {
      const { startAutoTagsAggregateCron } = await import('./modules/tags/contact-autotags-dirty.js');
      startAutoTagsAggregateCron();
    }
    // XÓA 2026-06-10 (CEO-review): cron cleanup handshake pending — cơ chế setup nick
    // nội bộ thủ công đã gỡ bỏ (gây bug gửi nhầm UID). Không còn handshake pending để dọn.
    // Phase Lead Pool 2026-05-24 — auto-return expired leads 2am daily
    startLeadPoolCron();
    // GĐ13a 2026-06-13 — tự dọn thùng rác Media sau 30 ngày (03:30 VN). Chỉ xóa hàng DB,
    // KHÔNG đụng byte MinIO. DRY-RUN mặc định BẬT (env MEDIA_TRASH_GC_DRYRUN='0' để bật xóa thật).
    if (config.nodeEnv !== 'test') {
      const { startMediaTrashGcCron } = await import('./modules/media/media-trash-gc-cron.js');
      startMediaTrashGcCron();
    }
    // Phase Multi-Source Lead Ads 2026-05-27 — outbox worker (LISTEN/NOTIFY + 30s poll)
    // dispatch fb webhook logs → Graph API fetch → normalize → route → insert entry.
    registerLogProcessor('fb-leadads', processFbWebhookLog);
    startOutboxWorker().catch((err) => logger.error('[outbox-worker] startup failed:', err));
    // Phase FB Pull 2026-05-30 — kéo lead chủ động bằng System User token (chính chủ,
    // không App Review). Chỉ chạy thật khi có Org bật fbPullEnabled. Skip lúc test.
    if (config.nodeEnv !== 'test') {
      const { startFbPullWorker } = await import('./modules/integrations/facebook-leadads/fb-pull-worker.js');
      startFbPullWorker();
      // Phase FB Lead Ads "Form" 2026-06-09 — BullMQ worker ingest lead + discovery form + cron refresh token.
      const { startFacebookLeadIngestionWorker } = await import('./modules/integrations/providers/facebook/facebook-lead-worker.js');
      void startFacebookLeadIngestionWorker();
      const { startFormDiscoveryWorker } = await import('./modules/integrations/providers/facebook/facebook-form-discovery-worker.js');
      void startFormDiscoveryWorker();
      const { startFacebookTokenRefreshCron } = await import('./modules/integrations/providers/facebook/facebook-token-refresh-cron.js');
      startFacebookTokenRefreshCron();
    }
    await eventBuffer.start(io);
    // Phase 7 — Automation engine (event bus + materializer + task worker + 3 action handlers)
    if (config.nodeEnv !== 'test') {
      const { startAutomationEngine } = await import('./modules/automation/engine/index.js');
      startAutomationEngine();
      // Phase F — Broadcast scheduler: poll automation_broadcasts scheduled→running
      const { startBroadcastScheduler } = await import('./modules/automation/broadcasts/broadcast-scheduler.js');
      startBroadcastScheduler();

      // ── Luồng Mục Tiêu Day 1+2 — BullMQ workers + sweeper + stats cron ──
      // Start AFTER engine để workers nhận event hooks từ M5 wire
      try {
        const { startFriendInviteWorker } = await import('./modules/automation/queues/friend-invite-worker.js');
        const { startSequenceStepWorker, startOutboxSweeper } = await import('./modules/automation/queues/sequence-step-worker.js');
        const { startInternalNotifyWorker } = await import('./modules/automation/queues/internal-notify-worker.js');
        const { startStatsReconcileCron } = await import('./modules/automation/queues/stats-reconcile-cron.js');

        startFriendInviteWorker();
        startSequenceStepWorker();
        startInternalNotifyWorker();
        startOutboxSweeper(5 * 60_000); // 5 phút sweep cycle (v4 Fix #1)
        startStatsReconcileCron();      // 02:30 VN daily reconcile drift

        // Broadcasts Đợt 1 (2026-06-05) — worker E2E gửi tin hàng loạt
        const { startBroadcastFireWorker } = await import('./modules/automation/queues/broadcast-fire-worker.js');
        startBroadcastFireWorker();

        logger.info('[luong-muc-tieu] BullMQ workers + sweeper + cron started');
      } catch (err) {
        logger.error(`[luong-muc-tieu] failed to start workers: ${(err as Error).message}`);
        // Non-fatal: legacy task-worker vẫn hoạt động
      }
      // Tệp khách hàng — enrichment worker + reverse-update event handlers
      startListEnrichmentWorker();
      registerCustomerListEventHandlers();
      // Phase Friend Invite Queue 2026-05-28 — sweepers + per-nick workers
      // #3 2026-06-06 — async vì đọc nhịp quét từ Cài đặt kỹ thuật (org settings).
      await startFriendInviteSweepers();
      // Wave 2 Welcome Probe 2026-05-29 — poll WELCOME_PROBE outbox rows
      startWelcomeProbeWorker();
      // bootstrap workers — guard with try/catch để container không restart loop
      // nếu DB chưa migrate đủ cột (đang phát triển feature)
      try {
        // Sprint v3 Tuần 3 Row 2.2: inject io trước bootstrap để emit socket
        // "friend-invite:claimed" tới Mục tiêu Detail dashboard realtime.
        setNickWorkerIO(io);
        await bootstrapFriendInviteWorkers();
      } catch (err) {
        logger.error('[friend-invite] bootstrap workers failed (non-fatal):', err);
      }
    }
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }

  // Reconnect Zalo accounts that have saved sessions
  try {
    // FIX 2 nick-ghost (2026-06-13): boot reconnect chỉ kéo nick THẬT (zaloUid != null)
    // chưa ẩn. Guard chính ở zaloPool.reconnect; đây là lớp 2 chặn thẻ ma bật WS lúc khởi
    // động server → tránh tranh chấp session với nick thật ngay sau boot.
    const accounts = await prisma.zaloAccount.findMany({
      where: { sessionData: { not: Prisma.JsonNull }, archivedAt: null, zaloUid: { not: null } },
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
