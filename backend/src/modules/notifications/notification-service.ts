import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from '../zalo/zalo-pool.js';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt: string;
  url: string;
}

export function getNotificationUrl(id: string): string {
  if (id === 'unreplied') return '/chat';
  if (id.startsWith('apt-')) return '/appointments';
  if (id === 'tmr-apts') return '/appointments';
  if (id.startsWith('zalo-')) return '/zalo-accounts';
  return '/';
}

export async function getCurrentNotifications(orgId: string): Promise<NotificationItem[]> {
  const notifications: NotificationItem[] = [];
  const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
  const unreplied = await prisma.conversation.count({
    where: { orgId, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
  });

  if (unreplied > 0) {
    notifications.push({
      id: 'unreplied',
      type: 'warning',
      priority: 'high',
      title: `${unreplied} cuộc trò chuyện chưa trả lời`,
      detail: 'Có tin nhắn chưa phản hồi quá 30 phút',
      createdAt: new Date().toISOString(),
      url: getNotificationUrl('unreplied'),
    });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const todayApts = await prisma.appointment.findMany({
    where: { orgId, appointmentDate: { gte: todayStart, lt: todayEnd }, status: 'scheduled' },
    include: { contact: { select: { fullName: true } } },
    take: 5,
  });

  for (const apt of todayApts) {
    const id = `apt-${apt.id}`;
    notifications.push({
      id,
      type: 'info',
      priority: 'medium',
      title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
      detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
      createdAt: apt.appointmentDate.toISOString(),
      url: getNotificationUrl(id),
    });
  }

  const tomorrowStart = new Date(todayEnd);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  const tmrApts = await prisma.appointment.count({
    where: { orgId, appointmentDate: { gte: tomorrowStart, lt: tomorrowEnd }, status: 'scheduled' },
  });

  if (tmrApts > 0) {
    notifications.push({
      id: 'tmr-apts',
      type: 'info',
      priority: 'low',
      title: `${tmrApts} lịch hẹn ngày mai`,
      detail: 'Chuẩn bị cho ngày mai',
      createdAt: new Date().toISOString(),
      url: getNotificationUrl('tmr-apts'),
    });
  }

  const accounts = await prisma.zaloAccount.findMany({
    where: { orgId },
    select: { id: true, displayName: true },
  });

  for (const acc of accounts) {
    const status = zaloPool.getStatus(acc.id);
    if (status !== 'connected') {
      const id = `zalo-${acc.id}`;
      notifications.push({
        id,
        type: 'error',
        priority: 'high',
        title: `Zalo "${acc.displayName}" mất kết nối`,
        detail: `Trạng thái: ${status}`,
        createdAt: new Date().toISOString(),
        url: getNotificationUrl(id),
      });
    }
  }

  return notifications;
}
