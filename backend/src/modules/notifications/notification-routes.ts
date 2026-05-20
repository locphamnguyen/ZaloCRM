/**
 * Notification routes — computed on-the-fly notifications for the authenticated user.
 * Sources: unreplied conversations, today/tomorrow appointments, disconnected Zalo accounts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt: string;
  status?: string;
  readAt?: string | null;
  resolvedAt?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  accountId?: string | null;
  threadId?: string | null;
  metadata?: unknown;
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  async function listNotifications(request: FastifyRequest) {
    const user = request.user!;
    const notifications: NotificationItem[] = [];

    const persistedWhere: any = {
      orgId: user.orgId,
      status: { not: 'resolved' },
    };
    if (user.role === 'member') {
      persistedWhere.OR = [{ ownerUserId: user.id }, { ownerUserId: null }];
    }

    const persisted = await prisma.notification.findMany({
      where: persistedWhere,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    for (const n of persisted) {
      notifications.push({
        id: n.id,
        type: n.type,
        priority: n.priority,
        title: n.title || n.type,
        detail: n.message,
        createdAt: n.createdAt.toISOString(),
        status: n.status,
        readAt: n.readAt?.toISOString() ?? null,
        resolvedAt: n.resolvedAt?.toISOString() ?? null,
        conversationId: n.conversationId,
        contactId: n.contactId,
        accountId: n.accountId,
        threadId: n.threadId,
        metadata: n.metadata,
      });
    }

    // 1. Unreplied conversations > 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
    const unreplied = await prisma.conversation.count({
      where: { orgId: user.orgId, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
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

    // 4. Disconnected Zalo accounts
    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
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
  }

  app.get('/api/v1/notifications', listNotifications);

  app.patch('/api/v1/notifications/:id', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { read?: boolean; resolved?: boolean; status?: string };

    const existing = await prisma.notification.findFirst({
      where: {
        id,
        orgId: user.orgId,
        ...(user.role === 'member' ? { OR: [{ ownerUserId: user.id }, { ownerUserId: null }] } : {}),
      },
      select: { id: true, status: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Notification not found' });

    const data: any = {};
    const now = new Date();
    if (body.status) {
      if (!['sent', 'read', 'resolved', 'failed'].includes(body.status)) {
        return reply.status(400).send({ error: 'Invalid notification status' });
      }
      data.status = body.status;
      if (body.status === 'read' && existing.status !== 'read') data.readAt = now;
      if (body.status === 'resolved') {
        data.resolvedAt = now;
        if (existing.status !== 'read') data.readAt = now;
      }
    }
    if (body.read === true) {
      data.status = data.status ?? 'read';
      data.readAt = now;
    }
    if (body.resolved === true) {
      data.status = 'resolved';
      data.resolvedAt = now;
      data.readAt = data.readAt ?? now;
    }

    if (Object.keys(data).length === 0) return reply.status(400).send({ error: 'No notification update requested' });

    const updated = await prisma.notification.update({
      where: { id },
      data,
    });
    return { notification: updated };
  });
}
