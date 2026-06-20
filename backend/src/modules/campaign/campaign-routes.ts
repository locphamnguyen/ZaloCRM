// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * campaign-routes.ts — Endpoints for outreach campaigns.
 *
 * Phase 1 surface:
 *   POST /api/v1/campaigns/random-friend-request
 *     body: { zaloAccountId: string; message?: string }
 *     → pick a random eligible contact and send a friend request
 *       (discovery of has-Zalo happens as a side-effect of the attempt).
 *   GET  /api/v1/campaigns/contacts/:contactId/attempts
 *     → counts of attempts per state, for UI display on contact detail.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { resolveAccount, checkAccess, handleError } from '../zalo/zalo-route-helpers.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { executeRandomFriendRequest } from './campaign-service.js';

interface RandomFriendReqBody {
  zaloAccountId: string;
  message?: string;
}

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post(
    '/api/v1/campaigns/random-friend-request',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { zaloAccountId, message } = (request.body ?? {}) as RandomFriendReqBody;

      if (!zaloAccountId) {
        return reply.status(400).send({ error: 'zaloAccountId is required' });
      }
      if (!(await checkAccess(request, reply, zaloAccountId, 'chat'))) return;

      try {
        await resolveAccount(zaloAccountId, user.orgId);
        const result = await executeRandomFriendRequest({
          orgId: user.orgId,
          zaloAccountId,
          message,
        });
        return reply.send(result);
      } catch (err) {
        logger.error('[campaign] random-friend-request error:', err);
        return handleError(reply, err, 'random-friend-request');
      }
    },
  );

  app.get(
    '/api/v1/campaigns/contacts/:contactId/attempts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { contactId } = request.params as { contactId: string };

      const contact = await prisma.contact.findFirst({
        where: { id: contactId, orgId: user.orgId },
        select: { id: true },
      });
      if (!contact) return reply.status(404).send({ error: 'contact_not_found' });

      const grouped = await prisma.friendshipAttempt.groupBy({
        by: ['state'],
        where: { contactId },
        _count: true,
      });
      const counts = Object.fromEntries(grouped.map((g) => [g.state, g._count]));

      const attempts = await prisma.friendshipAttempt.findMany({
        where: { contactId },
        orderBy: { queuedAt: 'desc' },
        select: {
          id: true,
          state: true,
          zaloAccountId: true,
          zaloUidFound: true,
          errorCode: true,
          queuedAt: true,
          sentAt: true,
          decidedAt: true,
          zaloAccount: { select: { id: true, displayName: true, phone: true } },
        },
      });

      return { counts, attempts };
    },
  );
}
