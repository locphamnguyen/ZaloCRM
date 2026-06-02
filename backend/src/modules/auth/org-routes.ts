/**
 * Organization settings routes — get and update current org info.
 * GET is accessible to all authenticated users; PUT requires owner role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { requireRole } from './role-middleware.js';
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
    { preHandler: requireRole('owner', 'admin') },
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
    { preHandler: requireRole('owner') },
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
}
