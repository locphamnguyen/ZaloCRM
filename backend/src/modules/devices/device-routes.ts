// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * device-routes.ts — FCM/APNs device registration cho push notification.
 * - POST   /api/v1/devices            — upsert device theo fcmToken (unique).
 * - DELETE /api/v1/devices/:fcmToken   — gỡ device (idempotent, chỉ của user hiện tại).
 * userId/orgId LẤY TỪ JWT, KHÔNG nhận từ body (tránh giả mạo cross-user/tenant).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';

const PLATFORMS = ['ios', 'android'] as const;

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /api/v1/devices — upsert theo fcmToken
  app.post<{ Body: { fcmToken?: string; platform?: string; deviceId?: string } }>(
    '/api/v1/devices',
    async (request: FastifyRequest<{ Body: { fcmToken?: string; platform?: string; deviceId?: string } }>, reply: FastifyReply) => {
      const { id: userId, orgId } = request.user as { id: string; orgId: string; role: string };
      const fcmToken = (request.body?.fcmToken ?? '').trim();
      const platform = (request.body?.platform ?? '').trim();
      const deviceId = (request.body?.deviceId ?? '').trim();

      if (!fcmToken || !platform || !deviceId) {
        return reply.status(400).send({ error: 'Thiếu fcmToken / platform / deviceId' });
      }
      if (!PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
        return reply.status(400).send({ error: "platform phải là 'ios' hoặc 'android'" });
      }

      const device = await prisma.device.upsert({
        where: { fcmToken },
        create: { fcmToken, userId, orgId, platform, deviceId },
        update: { userId, orgId, platform, deviceId, lastSeenAt: new Date() },
      });
      return { id: device.id };
    },
  );

  // DELETE /api/v1/devices/:fcmToken — idempotent, chỉ xóa device của chính user
  app.delete<{ Params: { fcmToken: string } }>(
    '/api/v1/devices/:fcmToken',
    async (request: FastifyRequest<{ Params: { fcmToken: string } }>) => {
      const { id: userId } = request.user as { id: string; orgId: string; role: string };
      await prisma.device.deleteMany({ where: { fcmToken: request.params.fcmToken, userId } });
      return { ok: true };
    },
  );
}
