import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { getCurrentNotifications } from './notification-service.js';
import { getWebPushConfig, sendPushToSubscriptions } from './web-push-service.js';

interface PushSubscriptionBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

interface DeleteSubscriptionBody {
  endpoint?: string;
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications = await getCurrentNotifications(user.orgId);
    return { notifications };
  });

  app.get('/api/v1/notifications/push/config', async () => getWebPushConfig());

  app.post<{ Body: PushSubscriptionBody }>('/api/v1/notifications/push/subscriptions', async (request, reply) => {
    const user = request.user!;
    const { endpoint, keys } = request.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Subscription không hợp lệ' });
    }

    const userAgent = request.headers['user-agent'];
    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      update: { orgId: user.orgId, userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent },
      create: { orgId: user.orgId, userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    });
    return { ok: true };
  });

  app.delete<{ Body: DeleteSubscriptionBody }>('/api/v1/notifications/push/subscriptions', async (request, reply) => {
    const user = request.user!;
    const endpoint = request.body?.endpoint;
    if (!endpoint) return reply.status(400).send({ error: 'Thiếu endpoint' });

    await prisma.webPushSubscription.deleteMany({ where: { userId: user.id, orgId: user.orgId, endpoint } });
    return { ok: true };
  });

  app.post('/api/v1/notifications/push/test', async (request) => {
    const user = request.user!;
    const subscriptions = await prisma.webPushSubscription.findMany({
      where: { userId: user.id, orgId: user.orgId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    const result = await sendPushToSubscriptions(subscriptions, {
      title: 'ZaloCRM thông báo thử',
      body: 'Thông báo Web Push đã sẵn sàng.',
      url: '/',
      tag: `test-${user.id}`,
      type: 'test',
      priority: 'low',
      createdAt: new Date().toISOString(),
    });
    return { ok: true, result };
  });
}
