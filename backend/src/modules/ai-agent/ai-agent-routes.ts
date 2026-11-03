// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { AGENT_SENT_VIA, agentNickIds, getAgentConfig, pendingCount } from './ai-agent-service.js';
import { DEFAULT_AGENT_KNOWLEDGE } from './ai-agent-prompt.js';
import { isWithinWorkHours, parseHm } from './ai-agent-rules.js';

const INT_FIELDS = {
  staffGraceMinutes: [0, 240],
  staffTakeoverMinutes: [0, 1440],
  minDelaySec: [1, 600],
  maxDelaySec: [1, 600],
  maxPerNickHour: [1, 200],
  maxPerNickDay: [1, 1000],
  maxPerConversationDay: [1, 100],
  handoffPauseHours: [1, 720],
} as const;

export async function aiAgentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/ai-agent/config — cấu hình + danh sách nick + thống kê 24h
  app.get('/api/v1/ai-agent/config', { preHandler: requireGrant('settings', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = request.user!.orgId;
      const cfg = await getAgentConfig(orgId);
      const [nicks, sent24h, handoff24h] = await Promise.all([
        prisma.zaloAccount.findMany({
          where: { orgId, archivedAt: null },
          select: { id: true, displayName: true, phone: true, status: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.message.count({ where: { sentVia: AGENT_SENT_VIA, conversation: { orgId }, sentAt: { gte: new Date(Date.now() - 86_400_000) } } }),
        prisma.message.count({
          where: { sentVia: AGENT_SENT_VIA, conversation: { orgId }, sentAt: { gte: new Date(Date.now() - 86_400_000) }, metadata: { path: ['aiAgent', 'handoff'], equals: true } },
        }),
      ]);
      return {
        config: { ...cfg, zaloAccountIds: agentNickIds(cfg), knowledgeBase: cfg.knowledgeBase ?? DEFAULT_AGENT_KNOWLEDGE },
        defaultKnowledge: DEFAULT_AGENT_KNOWLEDGE,
        nicks,
        stats: {
          sent24h,
          handoff24h,
          pending: pendingCount(),
          inWorkHours: isWithinWorkHours(new Date(), cfg.workStart, cfg.workEnd, cfg.timezone),
        },
      };
    } catch (err) {
      logger.error('[ai-agent] config GET error:', err);
      return reply.status(500).send({ error: 'Không tải được cấu hình AI Agent' });
    }
  });

  // PUT /api/v1/ai-agent/config
  app.put('/api/v1/ai-agent/config', { preHandler: requireGrant('settings', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = request.user!.orgId;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {};

      if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
      if (body.mode !== undefined) {
        if (!['off_hours', 'always'].includes(String(body.mode))) return reply.status(400).send({ error: 'Chế độ không hợp lệ' });
        data.mode = String(body.mode);
      }
      for (const key of ['workStart', 'workEnd'] as const) {
        if (body[key] !== undefined) {
          if (parseHm(String(body[key])) === null) return reply.status(400).send({ error: `${key} phải dạng HH:MM` });
          data[key] = String(body[key]);
        }
      }
      if (body.timezone !== undefined) {
        try {
          new Intl.DateTimeFormat('en-GB', { timeZone: String(body.timezone) });
        } catch {
          return reply.status(400).send({ error: 'Múi giờ không hợp lệ' });
        }
        data.timezone = String(body.timezone);
      }
      for (const [key, [min, max]] of Object.entries(INT_FIELDS)) {
        if (body[key] === undefined) continue;
        const n = Number(body[key]);
        if (!Number.isInteger(n) || n < min || n > max) return reply.status(400).send({ error: `${key} phải là số nguyên ${min}–${max}` });
        data[key] = n;
      }
      if (body.zaloAccountIds !== undefined) {
        if (!Array.isArray(body.zaloAccountIds)) return reply.status(400).send({ error: 'zaloAccountIds phải là mảng' });
        const ids = (body.zaloAccountIds as unknown[]).filter((x): x is string => typeof x === 'string');
        const owned = await prisma.zaloAccount.findMany({ where: { orgId, id: { in: ids } }, select: { id: true } });
        data.zaloAccountIds = owned.map((n) => n.id);
      }
      if (body.knowledgeBase !== undefined) {
        const kb = body.knowledgeBase === null ? null : String(body.knowledgeBase);
        if (kb && kb.length > 30_000) return reply.status(400).send({ error: 'Kiến thức tối đa 30.000 ký tự' });
        data.knowledgeBase = kb;
      }
      if (body.handoffKeywords !== undefined) data.handoffKeywords = String(body.handoffKeywords).slice(0, 2000);
      if (body.handoffMessage !== undefined) {
        const msg = String(body.handoffMessage).trim();
        if (!msg) return reply.status(400).send({ error: 'Câu chuyển nhân viên không được trống' });
        data.handoffMessage = msg.slice(0, 1000);
      }

      const merged = { ...(await getAgentConfig(orgId)), ...data } as { minDelaySec: number; maxDelaySec: number };
      if (merged.minDelaySec > merged.maxDelaySec) return reply.status(400).send({ error: 'Delay tối thiểu phải ≤ delay tối đa' });

      const updated = await prisma.aiAgentConfig.update({ where: { orgId }, data });
      logger.info(`[ai-agent] config updated org=${orgId} enabled=${updated.enabled} mode=${updated.mode}`);
      return { ok: true, config: { ...updated, zaloAccountIds: agentNickIds(updated) } };
    } catch (err) {
      logger.error('[ai-agent] config PUT error:', err);
      return reply.status(500).send({ error: 'Không lưu được cấu hình AI Agent' });
    }
  });
}
