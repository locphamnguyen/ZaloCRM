// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M7 — Bull Board admin UI mount (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// Mount @bull-board/fastify tại /internal/bullmq-board
// Auth: chỉ Owner + Admin (RBAC M2 pattern)
//
// 3 queues monitor: friend-invite, sequence-step, internal-notify
// Bull Board hiển thị: active/waiting/delayed/completed/failed counts +
// job inspector + retry/remove buttons + Lua quota peek (manual via redis-cli).

import type { FastifyInstance } from 'fastify';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/dist/queueAdapters/bullMQ.js';
import { FastifyAdapter } from '@bull-board/fastify';
import { logger } from '../../../shared/utils/logger.js';
import {
  getFriendInviteQueue,
  getSequenceStepQueue,
  getInternalNotifyQueue,
} from './queue-registry.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { prisma } from '../../../shared/database/prisma-client.js';

const BOARD_BASE_PATH = '/internal/bullmq-board';

export async function registerBullBoardRoutes(app: FastifyInstance): Promise<void> {
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(BOARD_BASE_PATH);

  createBullBoard({
    queues: [
      new BullMQAdapter(getFriendInviteQueue()),
      new BullMQAdapter(getSequenceStepQueue()),
      new BullMQAdapter(getInternalNotifyQueue()),
    ],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Luồng Mục Tiêu — BullMQ Board',
      },
    },
  });

  // Pre-handler check Owner+Admin role
  // (memory project_zalocrm_rbac_decisions M2 — Owner = role='owner', Admin từ permission_group)
  app.addHook('preHandler', async (request, reply) => {
    // Apply only to Bull Board paths
    if (!request.url.startsWith(BOARD_BASE_PATH)) return;

    // Run authMiddleware first
    try {
      await authMiddleware(request, reply);
    } catch (err) {
      logger.warn(`[bull-board] auth failed: ${(err as Error).message}`);
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Check role
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { role: true, permissionGroupId: true },
    });

    const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';
    if (!isOwnerOrAdmin) {
      logger.warn(
        `[bull-board] forbidden: user ${request.user.id} role=${user?.role}`,
      );
      return reply.code(403).send({ error: 'Chỉ Owner + Admin truy cập được Bull Board' });
    }
  });

  await app.register(serverAdapter.registerPlugin() as never, {
    prefix: BOARD_BASE_PATH,
  });

  logger.info(`[bull-board] mounted at ${BOARD_BASE_PATH} (Owner+Admin only)`);
}
