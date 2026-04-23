/**
 * group-view-routes.ts — REST API for ZaloGroupView CRUD + merged conversation listing.
 * Auth: authMiddleware on all routes. All queries org + user scoped.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  createView,
  listViews,
  getView,
  updateView,
  deleteView,
  listConversations,
} from './group-view-service.js';

// ── Validation helpers ────────────────────────────────────────────────────────

function validateName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0;
}

function validateAccountIds(ids: unknown): ids is string[] {
  return (
    Array.isArray(ids) &&
    ids.length >= 1 &&
    ids.length <= 20 &&
    ids.every((id) => typeof id === 'string' && id.length > 0)
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function groupViewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /api/v1/group-views — create a new group view
  app.post('/api/v1/group-views', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = request.body as Record<string, unknown>;

    if (!validateName(body.name)) {
      return reply.status(400).send({ error: 'name_required' });
    }
    if (!validateAccountIds(body.accountIds)) {
      return reply.status(400).send({ error: 'accountIds_invalid' });
    }

    const color = typeof body.color === 'string' ? body.color : null;

    const view = await createView(user, {
      name: body.name.trim(),
      accountIds: body.accountIds as string[],
      color,
    });

    return reply.status(201).send({ view });
  });

  // GET /api/v1/group-views — list current user's views
  app.get('/api/v1/group-views', async (request: FastifyRequest) => {
    const user = request.user!;
    const views = await listViews(user);
    return { views };
  });

  // GET /api/v1/group-views/:id — single view (org + user scoped)
  app.get('/api/v1/group-views/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const view = await getView(id, user);
    if (!view) return reply.status(404).send({ error: 'not_found' });

    return { view };
  });

  // PATCH /api/v1/group-views/:id — partial update
  app.patch('/api/v1/group-views/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const existing = await getView(id, user);
    if (!existing) return reply.status(404).send({ error: 'not_found' });

    const patch: { name?: string; accountIds?: string[]; color?: string | null } = {};

    if (body.name !== undefined) {
      if (!validateName(body.name)) {
        return reply.status(400).send({ error: 'name_required' });
      }
      patch.name = (body.name as string).trim();
    }

    if (body.accountIds !== undefined) {
      if (!validateAccountIds(body.accountIds)) {
        return reply.status(400).send({ error: 'accountIds_invalid' });
      }
      patch.accountIds = body.accountIds as string[];
    }

    if (body.color !== undefined) {
      patch.color = typeof body.color === 'string' ? body.color : null;
    }

    const view = await updateView(id, user, patch);
    return { view };
  });

  // DELETE /api/v1/group-views/:id → 204
  app.delete('/api/v1/group-views/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const existing = await getView(id, user);
    if (!existing) return reply.status(404).send({ error: 'not_found' });

    await deleteView(id);
    return reply.status(204).send();
  });

  // GET /api/v1/group-views/:id/conversations?cursor=&limit=&tab=
  app.get(
    '/api/v1/group-views/:id/conversations',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const q = request.query as Record<string, string | undefined>;

      const limit = Math.min(Math.max(1, Number(q.limit) || 30), 100);
      const tab = typeof q.tab === 'string' && q.tab.length > 0 ? q.tab : 'main';
      const cursor = typeof q.cursor === 'string' && q.cursor.length > 0 ? q.cursor : undefined;

      const result = await listConversations(id, user, { cursor, limit, tab });
      if (!result) return reply.status(404).send({ error: 'not_found' });

      return result;
    },
  );
}
