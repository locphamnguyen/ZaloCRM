/**
 * target-precheck-friend-lookup.test.ts — P3 (C1) regression.
 * Nguồn customer_list phải pre-check CẢ friend_lookup: nick chạm trần friend_lookup →
 * KHÔNG tạo FriendshipAttempt / KHÔNG chạm CustomerListEntry (không "đốt" contact).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkLimits = vi.fn();
const attemptFriendRequest = vi.fn();
const attemptFriendRequestByUid = vi.fn();

const prismaMock = {
  targetJob: { findMany: vi.fn(), update: vi.fn() },
  customerListEntry: { findFirst: vi.fn(), update: vi.fn() },
  targetRunItem: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn() },
  groupScan: { findUnique: vi.fn() },
  groupMember: { findFirst: vi.fn() },
  zaloAccount: { findUnique: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
  $queryRaw: vi.fn().mockResolvedValue([]),
};

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/tenant/tenant-context.js', () => ({
  runSystemQuery: (fn: any) => fn(),
  withTenant: (_org: string, fn: any) => fn(),
}));
vi.mock('../src/modules/zalo/zalo-rate-limiter.js', () => ({ zaloRateLimiter: { checkLimits } }));
vi.mock('../src/modules/campaign/campaign-service.js', () => ({
  attemptFriendRequest, attemptFriendRequestByUid,
}));
vi.mock('../src/modules/broadcast/broadcast-service.js', () => ({
  isWithinSendWindow: () => true,
  randomDelayMs: () => 0,
  renderMessage: (t: string) => t,
}));
vi.mock('../src/modules/broadcast/broadcast-cron.js', () => ({
  resolveJobContent: vi.fn().mockResolvedValue({ messageText: '', imageUrl: null, blockId: null }),
}));
vi.mock('../src/shared/zalo-operations.js', () => ({
  zaloOps: { sendMessage: vi.fn(), sendImage: vi.fn() },
  ZaloOpError: class ZaloOpError extends Error { code: string; constructor(m: string, c: string) { super(m); this.code = c; } },
}));
vi.mock('../src/modules/contacts/resolve-contact.js', () => ({ resolveOrCreateContact: vi.fn() }));
vi.mock('../src/modules/chat/chat-media-helpers.js', () => ({ downloadMediaToTemp: vi.fn() }));

const { runTargetTick } = await import('../src/modules/target/target-cron.js');

const CUSTOMER_LIST_JOB = {
  id: 'job-1', orgId: 'org-1', sourceType: 'customer_list', customerListId: 'list-1', groupScanId: null,
  zaloAccountId: 'nick-1', requestMsg: 'hi', maxTotal: 200, delaySecMin: 60, delaySecMax: 180,
  lastSentAt: null, sentCount: 0, noZaloCount: 0, failedCount: 0, welcomeEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.targetRunItem.findMany.mockResolvedValue([]);
  // findMany: lần 1 = job active; lần 2 = welcome jobs (rỗng)
  prismaMock.targetJob.findMany.mockReset()
    .mockResolvedValueOnce([{ ...CUSTOMER_LIST_JOB }])
    .mockResolvedValueOnce([]);
});

describe('runTargetTick pre-check friend_lookup (P3)', () => {
  it('nick chạm trần friend_lookup → KHÔNG đụng CustomerListEntry, KHÔNG gọi attemptFriendRequest', async () => {
    checkLimits.mockImplementation((_acct: string, cat: string) =>
      Promise.resolve({ allowed: cat === 'friend_action' })); // friend_action ok, friend_lookup chặn

    await runTargetTick();

    expect(checkLimits).toHaveBeenCalledWith('nick-1', 'friend_action', { failClosed: true });
    expect(checkLimits).toHaveBeenCalledWith('nick-1', 'friend_lookup', { failClosed: true });
    expect(prismaMock.customerListEntry.findFirst).not.toHaveBeenCalled();
    expect(attemptFriendRequest).not.toHaveBeenCalled();
  });

  it('cả hai category còn quota → tiếp tục xử lý (chạm CustomerListEntry)', async () => {
    checkLimits.mockResolvedValue({ allowed: true });
    prismaMock.customerListEntry.findFirst.mockResolvedValue(null); // hết đối tượng → job done, đủ để xác nhận đã vào nhánh

    await runTargetTick();

    expect(checkLimits).toHaveBeenCalledWith('nick-1', 'friend_lookup', { failClosed: true });
    expect(prismaMock.customerListEntry.findFirst).toHaveBeenCalled();
  });
});
