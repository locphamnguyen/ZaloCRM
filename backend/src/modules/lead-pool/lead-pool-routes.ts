/**
 * lead-pool-routes.ts — Phase Lead Pool 2026-05-24.
 *
 * 7 endpoints:
 *   GET   /api/v1/lead-pool/eligibility       — check trước khi xin
 *   POST  /api/v1/lead-pool/request           — xin lead mới
 *   POST  /api/v1/lead-pool/:id/note          — submit note
 *   POST  /api/v1/lead-pool/:id/return        — trả lại pool
 *   GET   /api/v1/lead-pool/config            — load org config (admin)
 *   PATCH /api/v1/lead-pool/config            — update config (admin)
 *   GET   /api/v1/lead-pool/my-history        — lịch sử lead user đã nhận
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import {
  LeadPoolError,
  checkEligibility,
  requestLead,
  submitNote,
  returnLead,
  getMyHistory,
  getOrCreateConfig,
  updateConfig,
} from './lead-pool-service.js';

function handle(err: unknown, reply: FastifyReply) {
  if (err instanceof LeadPoolError) {
    return reply.status(err.statusCode).send({
      error: err.message,
      code: err.errorCode,
      meta: (err as any).meta,
    });
  }
  return reply.status(500).send({ error: (err as Error)?.message || 'Internal error' });
}

export async function leadPoolRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/lead-pool/eligibility', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      return await checkEligibility(user.orgId, user.id);
    } catch (err) {
      return handle(err, reply);
    }
  });

  app.post('/api/v1/lead-pool/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      return await requestLead({ orgId: user.orgId, userId: user.id });
    } catch (err) {
      return handle(err, reply);
    }
  });

  app.post('/api/v1/lead-pool/:id/note', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { noteContent?: string };
    if (!body.noteContent) return reply.status(400).send({ error: 'noteContent là bắt buộc' });
    try {
      return await submitNote({ userId: user.id, leadRequestId: id, noteContent: body.noteContent });
    } catch (err) {
      return handle(err, reply);
    }
  });

  app.post('/api/v1/lead-pool/:id/return', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: string };
    try {
      return await returnLead({ userId: user.id, leadRequestId: id, reason: body.reason });
    } catch (err) {
      return handle(err, reply);
    }
  });

  app.get(
    '/api/v1/lead-pool/config',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      try {
        return await getOrCreateConfig(user.orgId);
      } catch (err) {
        return handle(err, reply);
      }
    },
  );

  app.patch(
    '/api/v1/lead-pool/config',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const patch = (request.body ?? {}) as Record<string, unknown>;
      try {
        return await updateConfig(user.orgId, patch as any);
      } catch (err) {
        return handle(err, reply);
      }
    },
  );

  app.get('/api/v1/lead-pool/my-history', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    try {
      return await getMyHistory({ userId: user.id, limit });
    } catch (err) {
      return handle(err, reply);
    }
  });

  // GET /api/v1/lead-pool/preview — admin xem queue robin top N
  // Query: ?limit=200 ?filter=available|assigned|cooldown|returned_today
  app.get(
    '/api/v1/lead-pool/preview',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const query = request.query as { limit?: string; filter?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 200;
      const validFilters = ['available', 'assigned', 'cooldown', 'returned_today'] as const;
      const filter = (validFilters as readonly string[]).includes(query.filter ?? '')
        ? (query.filter as typeof validFilters[number])
        : 'available';
      try {
        const { previewPool } = await import('./lead-pool-service.js');
        return await previewPool({ orgId: user.orgId, userId: user.id, limit, filter });
      } catch (err) {
        return handle(err, reply);
      }
    },
  );

  // GET /api/v1/lead-pool/queue-today-stats — 4 KPI cho Queue Lead admin page
  app.get(
    '/api/v1/lead-pool/queue-today-stats',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      try {
        const { getQueueTodayStats } = await import('./lead-pool-service.js');
        return await getQueueTodayStats({ orgId: user.orgId });
      } catch (err) {
        return handle(err, reply);
      }
    },
  );

  // GET /api/v1/lead-pool/stats — tooltip data theo role
  app.get('/api/v1/lead-pool/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const { getLeadPoolStats } = await import('./lead-pool-service.js');
      return await getLeadPoolStats({ orgId: user.orgId, userId: user.id, role: user.role });
    } catch (err) {
      return handle(err, reply);
    }
  });

  // POST /api/v1/lead-pool/:id/open-chat — Body: { zaloAccountId? }
  // Nếu có zaloAccountId → lookup KH bằng nick đó, tạo Friend row, return convId.
  // Nếu không → fallback dùng Friend có sẵn.
  app.post('/api/v1/lead-pool/:id/open-chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { zaloAccountId?: string };
    try {
      const { openChatForLead } = await import('./lead-pool-service.js');
      return await openChatForLead({ userId: user.id, orgId: user.orgId, leadRequestId: id, zaloAccountId: body.zaloAccountId });
    } catch (err) {
      return handle(err, reply);
    }
  });

  // POST /api/v1/lead-pool/:id/find-zalo — Body: { zaloAccountId? }
  // Sale chọn nick cụ thể (zaloAccountId) hoặc dùng default first-own → findUser.
  app.post('/api/v1/lead-pool/:id/find-zalo', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { zaloAccountId?: string };
    try {
      const { findZaloForLead } = await import('./lead-pool-service.js');
      return await findZaloForLead({ userId: user.id, orgId: user.orgId, leadRequestId: id, zaloAccountId: body.zaloAccountId });
    } catch (err) {
      return handle(err, reply);
    }
  });

  // ── Phase 2026-05-28 Admin Reset Quota ─────────────────────────────────────

  // GET /api/v1/lead-pool/admin/sale-noted-leads?userId=... — list leads để reviewer xem
  app.get('/api/v1/lead-pool/admin/sale-noted-leads', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const q = request.query as { userId?: string };
    if (!q.userId) return reply.status(400).send({ error: 'Cần query userId' });
    try {
      const { listSaleNotedLeadsToday } = await import('./lead-pool-service.js');
      return await listSaleNotedLeadsToday({
        requester: { id: user.id, role: user.role, orgId: user.orgId },
        targetUserId: q.userId,
      });
    } catch (err) {
      return handle(err, reply);
    }
  });

  // POST /api/v1/lead-pool/admin/reset-quota
  // Body: { targetUserId, reviewedLeadIds: string[], bonusCount: 1..maxPerDay, reason? }
  app.post('/api/v1/lead-pool/admin/reset-quota', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body ?? {}) as {
      targetUserId?: string; reviewedLeadIds?: string[]; bonusCount?: number; reason?: string;
    };
    if (!body.targetUserId || !Array.isArray(body.reviewedLeadIds) || typeof body.bonusCount !== 'number') {
      return reply.status(400).send({ error: 'Cần targetUserId, reviewedLeadIds[], bonusCount' });
    }
    try {
      const { adminResetQuota } = await import('./lead-pool-service.js');
      return await adminResetQuota({
        requester: { id: user.id, role: user.role, orgId: user.orgId },
        targetUserId: body.targetUserId,
        reviewedLeadIds: body.reviewedLeadIds,
        bonusCount: body.bonusCount,
        reason: body.reason,
      });
    } catch (err) {
      return handle(err, reply);
    }
  });

  // GET /api/v1/lead-pool/:id/payload — rebuild full payload cho pending lead (reopen modal)
  app.get('/api/v1/lead-pool/:id/payload', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    try {
      const { getLeadPayload } = await import('./lead-pool-service.js');
      return await getLeadPayload({ userId: user.id, orgId: user.orgId, leadRequestId: id });
    } catch (err) {
      return handle(err, reply);
    }
  });

  // GET /api/v1/lead-pool/available-nicks — list nick online (own + team if manager/admin)
  app.get('/api/v1/lead-pool/available-nicks', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const { listAvailableNicks } = await import('./lead-pool-service.js');
      return await listAvailableNicks({ orgId: user.orgId, userId: user.id, role: user.role });
    } catch (err) {
      return handle(err, reply);
    }
  });
}
