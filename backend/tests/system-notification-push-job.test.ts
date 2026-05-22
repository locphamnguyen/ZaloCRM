import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const getCurrentNotifications = vi.fn();
const sendPushToOrg = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: { organization: { findMany } },
}));

vi.mock('../src/modules/notifications/notification-service.js', () => ({ getCurrentNotifications }));
vi.mock('../src/modules/notifications/web-push-service.js', () => ({ sendPushToOrg }));

describe('system notification push job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([{ id: 'org-1' }]);
    getCurrentNotifications.mockResolvedValue([
      { id: 'unreplied', title: '1 cuộc trò chuyện chưa trả lời', detail: 'Có tin nhắn chưa phản hồi quá 30 phút', type: 'warning', priority: 'high', createdAt: '2026-05-21T00:00:00.000Z', url: '/chat' },
    ]);
    sendPushToOrg.mockResolvedValue({ enabled: true, attempted: 1, sent: 1, expired: 0, failed: 0 });
  });

  it('sends each current notification once per bucket', async () => {
    const { runSystemNotificationPushOnce } = await import('../src/modules/notifications/system-notification-push-job.js');

    await runSystemNotificationPushOnce(1234567890);
    await runSystemNotificationPushOnce(1234567890);

    expect(sendPushToOrg).toHaveBeenCalledTimes(1);
    expect(sendPushToOrg).toHaveBeenCalledWith('org-1', expect.objectContaining({ title: '1 cuộc trò chuyện chưa trả lời', tag: 'system-unreplied' }));
  });
});
