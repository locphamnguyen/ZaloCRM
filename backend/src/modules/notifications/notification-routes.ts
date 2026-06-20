// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Notification routes — computed on-the-fly notifications for the authenticated user.
 * Sources: unreplied conversations, today/tomorrow appointments, disconnected Zalo accounts.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { getZaloScope } from '../zalo/zalo-scope.js';
import { getContactScope } from '../contacts/contact-scope.js';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt: string;
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications: NotificationItem[] = [];

    // Phase Marketing+Analytics Scope 2026-05-27: scope notification theo viewer
    const [zScope, cScope] = await Promise.all([
      getZaloScope(user.id, user.orgId, user.role),
      getContactScope(user.id, user.orgId, user.role),
    ]);
    const convScope: any = zScope.isOrgAdmin ? {} : { zaloAccountId: { in: zScope.accessibleIds } };
    const apptScope: any =
      !cScope.isOrgAdmin && cScope.accessibleContactIds !== null
        ? { contactId: { in: cScope.accessibleContactIds } }
        : {};
    const accountScope: any = zScope.isOrgAdmin ? {} : { id: { in: zScope.accessibleIds } };

    // 1. Unreplied conversations > 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
    const unreplied = await prisma.conversation.count({
      where: { orgId: user.orgId, ...convScope, deletedAt: null, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
    });
    if (unreplied > 0) {
      notifications.push({
        id: 'unreplied',
        type: 'warning',
        priority: 'high',
        title: `${unreplied} cuộc trò chuyện chưa trả lời`,
        detail: 'Có tin nhắn chưa phản hồi quá 30 phút',
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Today's appointments
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayApts = await prisma.appointment.findMany({
      where: {
        orgId: user.orgId,
        ...apptScope,
        appointmentDate: { gte: todayStart, lt: todayEnd },
        status: 'scheduled',
      },
      include: { contact: { select: { fullName: true } } },
      take: 5,
    });
    for (const apt of todayApts) {
      notifications.push({
        id: `apt-${apt.id}`,
        type: 'info',
        priority: 'medium',
        title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
        detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
        createdAt: apt.appointmentDate.toISOString(),
      });
    }

    // 3. Tomorrow's appointments
    const tomorrowStart = new Date(todayEnd);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const tmrApts = await prisma.appointment.count({
      where: {
        orgId: user.orgId,
        ...apptScope,
        appointmentDate: { gte: tomorrowStart, lt: tomorrowEnd },
        status: 'scheduled',
      },
    });
    if (tmrApts > 0) {
      notifications.push({
        id: 'tmr-apts',
        type: 'info',
        priority: 'low',
        title: `${tmrApts} lịch hẹn ngày mai`,
        detail: 'Chuẩn bị cho ngày mai',
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Disconnected Zalo accounts (2026-06-10: ẩn nick đã xóa mềm).
    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId, archivedAt: null, ...accountScope },
      select: { id: true, displayName: true },
    });
    for (const acc of accounts) {
      const status = zaloPool.getStatus(acc.id);
      if (status !== 'connected') {
        notifications.push({
          id: `zalo-${acc.id}`,
          type: 'error',
          priority: 'high',
          title: `Zalo "${acc.displayName}" mất kết nối`,
          detail: `Trạng thái: ${status}`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return { notifications };
  });
}
