import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
const deleteMany = vi.fn();
const findMany = vi.fn();

vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails },
  sendNotification,
  setVapidDetails,
}));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: { webPushSubscription: { deleteMany, findMany } },
}));

describe('web-push-service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.VAPID_PUBLIC;
    delete process.env.VAPID_PRIVATE;
    delete process.env.VAPID_SUBJECT;
  });

  it('reports disabled config when VAPID keys are missing', async () => {
    const { getWebPushConfig } = await import('../src/modules/notifications/web-push-service.js');

    expect(getWebPushConfig()).toEqual({ enabled: false, publicKey: '' });
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  it('sends payload and deletes expired subscriptions', async () => {
    process.env.VAPID_PUBLIC = 'public-key';
    process.env.VAPID_PRIVATE = 'private-key';
    process.env.VAPID_SUBJECT = 'mailto:admin@example.com';
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    const { sendPushToSubscriptions } = await import('../src/modules/notifications/web-push-service.js');

    const result = await sendPushToSubscriptions([
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p256dh', auth: 'auth' },
    ], {
      title: 'Tin nhắn mới',
      body: 'Khách hàng gửi tin nhắn',
      url: '/chat',
      tag: 'chat-conv-1',
      type: 'chat',
      priority: 'high',
      createdAt: '2026-05-21T00:00:00.000Z',
    });

    expect(setVapidDetails).toHaveBeenCalledWith('mailto:admin@example.com', 'public-key', 'private-key');
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sub-1'] } } });
    expect(result).toEqual({ attempted: 1, sent: 0, expired: 1, failed: 0, enabled: true });
  });
});
