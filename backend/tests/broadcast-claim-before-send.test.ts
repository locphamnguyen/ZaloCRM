/**
 * broadcast-claim-before-send.test.ts — P4 (C2) regression.
 * processRun phải CLAIM (create BroadcastRunItem 'sending') TRƯỚC khi gọi Zalo. Nếu claim
 * ném P2002 (recipient đã được tick khác gửi) → KHÔNG gửi lại (chống gửi trùng).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMessage = vi.fn().mockResolvedValue({ msgId: 'm1' });

const prismaMock: any = {
  broadcastJob: { findMany: vi.fn(), findUnique: vi.fn() },
  broadcastRun: { findMany: vi.fn(), update: vi.fn() },
  broadcastRunItem: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  friend: { findFirst: vi.fn() },
  contentBlock: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
};

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/tenant/tenant-context.js', () => ({
  runSystemQuery: (fn: any) => fn(),
  withTenant: (_org: string, fn: any) => fn(),
}));
vi.mock('../src/shared/zalo-operations.js', () => ({
  zaloOps: { sendMessage, sendImage: vi.fn(), findUser: vi.fn() },
  ZaloOpError: class ZaloOpError extends Error { code: string; constructor(m: string, c: string) { super(m); this.code = c; } },
}));
vi.mock('../src/modules/chat/chat-media-helpers.js', () => ({ downloadMediaToTemp: vi.fn() }));
vi.mock('../src/modules/broadcast/broadcast-service.js', () => ({
  isWithinSendWindow: () => true,
  randomDelayMs: () => 0,
  renderMessage: (t: string) => t,
  computeNextRunAt: () => new Date(Date.now() + 86400000),
}));

const { runBroadcastTick } = await import('../src/modules/broadcast/broadcast-cron.js');

const JOB = {
  id: 'job-1', orgId: 'org-1', status: 'active', sourceType: 'friends',
  zaloAccountId: 'nick-1', customerListId: null, messageText: 'hello {{ten}}', imageUrl: null,
  contentBlockIds: [], delaySecMin: 30, delaySecMax: 90, maxPerRun: 50,
  scheduleType: 'daily', scheduledAt: null, timeOfDay: '09:00', daysOfWeek: [],
};
const RUN = { id: 'run-1', orgId: 'org-1', jobId: 'job-1', lastSentAt: null, sentCount: 0, failedCount: 0, skippedCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.broadcastJob.findMany.mockResolvedValue([]);          // không kích job mới
  prismaMock.broadcastRun.findMany.mockResolvedValue([{ ...RUN }]); // 1 run đang chạy
  prismaMock.broadcastJob.findUnique.mockResolvedValue({ ...JOB });
  prismaMock.broadcastRunItem.findMany.mockResolvedValue([]);
  prismaMock.friend.findFirst.mockResolvedValue({ id: 'fr-1', zaloUidInNick: 'uid-1', zaloDisplayName: 'A' });
});

describe('broadcast claim-before-send (P4)', () => {
  it('happy path: CLAIM item status=sending TRƯỚC, rồi mới gọi sendMessage', async () => {
    const order: string[] = [];
    prismaMock.broadcastRunItem.create.mockImplementation((args: any) => {
      order.push('claim:' + args.data.status);
      return Promise.resolve({ id: 'item-1' });
    });
    sendMessage.mockImplementation(() => { order.push('send'); return Promise.resolve({ msgId: 'm1' }); });

    await runBroadcastTick(null);

    expect(prismaMock.broadcastRunItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sending', runId: 'run-1', entryId: 'fr-1' }) }),
    );
    expect(order).toEqual(['claim:sending', 'send']); // claim trước, gửi sau
  });

  it('claim ném P2002 (đã có tick khác gửi) → KHÔNG gọi sendMessage', async () => {
    prismaMock.broadcastRunItem.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

    await runBroadcastTick(null);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
