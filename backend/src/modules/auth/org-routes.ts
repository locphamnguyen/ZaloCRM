/**
 * Organization settings routes — get and update current org info.
 * GET is accessible to all authenticated users; PUT requires owner role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';

// Offset string "+HH:MM" hoặc "-HH:MM" (vd "+07:00"). HH 00-14, MM 00/15/30/45.
const TIMEZONE_REGEX = /^[+-](0\d|1[0-4]):(00|15|30|45)$/;

function normalizeTimezone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!TIMEZONE_REGEX.test(trimmed)) return null;
  return trimmed;
}

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/organization — get current org info
  app.get('/api/v1/organization', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: {
          id: true, name: true, timezone: true, createdAt: true, updatedAt: true,
          // Phase Privacy v2 2026-05-23 — system notify nick (org-wide sender)
          systemNotifyZaloAccountId: true,
          systemNotifyNick: {
            select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true },
          },
        },
      });
      if (!org) return reply.status(404).send({ error: 'Organization not found' });
      return org;
    } catch {
      return reply.status(500).send({ error: 'Failed to fetch organization' });
    }
  });

  // Phase Privacy v2 2026-05-23 — admin pick nick chuyên gửi system notification cho cả org.
  // PATCH /api/v1/organization/system-notify-nick { zaloAccountId: string | null }
  // Admin pick bất kỳ nick org có. Validation: nick exists, in same org. KHÔNG yêu cầu admin own.
  app.patch(
    '/api/v1/organization/system-notify-nick',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body ?? {}) as { zaloAccountId?: string | null };
      const accountId = body.zaloAccountId ?? null;

      if (accountId !== null) {
        const nick = await prisma.zaloAccount.findFirst({
          where: { id: accountId, orgId: user.orgId },
          select: { id: true, status: true, displayName: true },
        });
        if (!nick) return reply.status(404).send({ error: 'Nick không tồn tại trong org' });
        // Warning nếu nick disconnected — không block, để admin biết
        if (nick.status !== 'connected') {
          logger.warn(`Org system-notify-nick set to disconnected nick: ${nick.displayName} (${accountId})`);
        }
      }

      await prisma.organization.update({
        where: { id: user.orgId },
        data: { systemNotifyZaloAccountId: accountId },
      });

      return { ok: true, systemNotifyZaloAccountId: accountId };
    },
  );

  // PUT /api/v1/organization — update org info (owner only). name + timezone đều optional,
  // nhưng phải có ít nhất 1 field hợp lệ.
  app.put(
    '/api/v1/organization',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body ?? {}) as { name?: string; timezone?: string };

      const data: { name?: string; timezone?: string } = {};

      if (body.name !== undefined) {
        const trimmed = String(body.name).trim();
        if (!trimmed) return reply.status(400).send({ error: 'Tên tổ chức là bắt buộc' });
        data.name = trimmed;
      }

      if (body.timezone !== undefined) {
        const tz = normalizeTimezone(body.timezone);
        if (!tz) {
          return reply
            .status(400)
            .send({ error: 'Múi giờ không hợp lệ. Định dạng: +HH:MM hoặc -HH:MM (vd +07:00).' });
        }
        data.timezone = tz;
      }

      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'Không có thay đổi nào để lưu' });
      }

      try {
        const org = await prisma.organization.update({
          where: { id: user.orgId },
          data,
          select: { id: true, name: true, timezone: true, createdAt: true, updatedAt: true },
        });
        logger.info(
          `Organization updated: ${org.name} (tz=${org.timezone}) by ${user.email}`,
        );
        return org;
      } catch {
        return reply.status(500).send({ error: 'Failed to update organization' });
      }
    },
  );

  // Wave 2 refactor 2026-05-29 — /welcome-config endpoints REMOVED.
  // Welcome template + delay are now per-trigger (see automation_triggers
  // .welcome_message_template / .welcome_delay_seconds). Cross-trigger knobs
  // (welcomeMaxRetries, welcomeStrangerInboxEnabled, welcomeHardFailStops)
  // remain on Organization but are not exposed via this route anymore.

  // ── #3 2026-06-06 (Anh chốt): Cài đặt kỹ thuật automation (admin) ──────────
  // Nhóm tham số VẬN HÀNH nội bộ (nhịp quét, ngưỡng kẹt, timeout...) — trước đây
  // hardcode trong sweepers/worker. Đưa ra trang "Cài đặt kỹ thuật" cho admin.
  // GET cho mọi user xem; PUT chỉ owner/admin. Tất cả số nguyên dương.
  const TECH_FIELDS = [
    'autoStuckSweepSeconds', 'autoDrainerSweepSeconds', 'autoWelcomeProbeSeconds',
    'autoRemindSweepMinutes', 'autoStuckThresholdMinutes', 'autoStuckMaxRecovery',
    'autoCampaignTimeoutHours', 'autoNickOfflineResetHours',
  ] as const;
  // Range guard mỗi field (min, max) — chặn giá trị vô lý gây treo hệ thống.
  const TECH_RANGES: Record<(typeof TECH_FIELDS)[number], [number, number]> = {
    autoStuckSweepSeconds: [10, 3600],
    autoDrainerSweepSeconds: [5, 3600],
    autoWelcomeProbeSeconds: [5, 3600],
    autoRemindSweepMinutes: [1, 1440],
    autoStuckThresholdMinutes: [1, 1440],
    autoStuckMaxRecovery: [1, 1000],
    autoCampaignTimeoutHours: [1, 720],
    autoNickOfflineResetHours: [1, 720],
  };

  const techSelect = Object.fromEntries(TECH_FIELDS.map((f) => [f, true]));

  // GET /api/v1/organization/automation-settings
  app.get('/api/v1/organization/automation-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const org = await prisma.organization.findUnique({
      where: { id: user.orgId },
      select: techSelect,
    });
    if (!org) return reply.status(404).send({ error: 'Organization not found' });
    return org;
  });

  // PUT /api/v1/organization/automation-settings — owner/admin only
  app.put(
    '/api/v1/organization/automation-settings',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const data: Record<string, number> = {};
      for (const field of TECH_FIELDS) {
        if (body[field] === undefined) continue;
        const v = Number(body[field]);
        const [min, max] = TECH_RANGES[field];
        if (!Number.isFinite(v) || v < min || v > max) {
          return reply.status(400).send({ error: `${field}_invalid`, hint: `Phải từ ${min} đến ${max}` });
        }
        data[field] = Math.round(v);
      }
      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'no_fields', hint: 'Không có tham số hợp lệ để cập nhật' });
      }
      const org = await prisma.organization.update({
        where: { id: user.orgId },
        data,
        select: techSelect,
      });
      logger.info(`[org] automation-settings updated by ${user.email}: ${Object.keys(data).join(',')}`);
      return { ok: true, settings: org };
    },
  );
}
