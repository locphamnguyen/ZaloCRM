import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockUser } from './test-helpers.js';

const create = vi.fn();
const update = vi.fn();
const findUnique = vi.fn();
const deleteMany = vi.fn();
const findMany = vi.fn();
const sendPushToSubscriptions = vi.fn();

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (request: any) => {
    request.user = mockUser({ id: 'user-1', orgId: 'org-1' });
  },
}));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    webPushSubscription: { create, update, findUnique, deleteMany, findMany },
  },
}));

vi.mock('../src/modules/notifications/notification-service.js', () => ({
  getCurrentNotifications: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/modules/notifications/web-push-service.js', () => ({
  getWebPushConfig: () => ({ enabled: true, publicKey: 'public-key' }),
  sendPushToSubscriptions,
}));

describe('notification push routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: 'sub-1' });
    update.mockResolvedValue({ id: 'sub-1' });
    findUnique.mockResolvedValue(null);
    deleteMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p256dh', auth: 'auth' }]);
    sendPushToSubscriptions.mockResolvedValue({ attempted: 1, sent: 1, expired: 0, failed: 0, enabled: true });
  });

  async function buildApp() {
    const { notificationRoutes } = await import('../src/modules/notifications/notification-routes.js');
    const app = Fastify({ logger: false });
    await app.register(notificationRoutes);
    return app;
  }

  it('returns push config', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications/push/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, publicKey: 'public-key' });
  });

  it('creates the authenticated user subscription', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/push/subscriptions',
      payload: {
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
      headers: { 'user-agent': 'vitest' },
    });

    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: { orgId: 'org-1', userId: 'user-1', endpoint: 'https://push.example/1', p256dh: 'p256dh', auth: 'auth', userAgent: 'vitest' },
    });
    expect(res.json()).toEqual({ ok: true });
  });

  it('updates an existing subscription owned by the authenticated user', async () => {
    findUnique.mockResolvedValue({ userId: 'user-1', orgId: 'org-1' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/push/subscriptions',
      payload: {
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
      },
      headers: { 'user-agent': 'vitest' },
    });

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/1' },
      data: { p256dh: 'new-p256dh', auth: 'new-auth', userAgent: 'vitest' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an existing subscription owned by another principal', async () => {
    findUnique.mockResolvedValue({ userId: 'user-2', orgId: 'org-2' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/push/subscriptions',
      payload: {
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
    });

    expect(res.statusCode).toBe(409);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('deletes the authenticated user subscription endpoint', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/notifications/push/subscriptions',
      payload: { endpoint: 'https://push.example/1' },
    });

    expect(res.statusCode).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', orgId: 'org-1', endpoint: 'https://push.example/1' } });
    expect(res.json()).toEqual({ ok: true });
  });

  it('sends a test notification to the authenticated user', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/push/test' });

    expect(res.statusCode).toBe(200);
    expect(sendPushToSubscriptions).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ title: 'ZaloCRM thông báo thử', url: '/' }));
    expect(res.json()).toEqual({ ok: true, result: { attempted: 1, sent: 1, expired: 0, failed: 0, enabled: true } });
  });
});
