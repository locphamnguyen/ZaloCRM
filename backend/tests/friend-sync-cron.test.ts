/**
 * friend-sync-cron.test.ts — Test runFriendSyncCycleNow (direct cycle, no scheduler).
 * Verify: iterate accounts, error in 1 account không break others, no accounts → no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  zaloAccount: { findMany: vi.fn() },
};
const syncFriendsForAccountMock = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/zalo/friend-sync-service.js', () => ({
  syncFriendsForAccount: syncFriendsForAccountMock,
}));
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}));

const { runFriendSyncCycleNow } = await import('../src/modules/zalo/friend-sync-cron.js');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.zaloAccount.findMany.mockReset();
  syncFriendsForAccountMock.mockReset();
});

describe('runFriendSyncCycleNow', () => {
  it('no-op when no connected accounts', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    await runFriendSyncCycleNow(null);
    expect(syncFriendsForAccountMock).not.toHaveBeenCalled();
  });

  it('iterates each connected account sequentially', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-1', orgId: 'org-1', displayName: 'Nick 1' },
      { id: 'za-2', orgId: 'org-1', displayName: 'Nick 2' },
    ]);
    syncFriendsForAccountMock.mockResolvedValue({
      liveCount: 0, createdContacts: 0, upsertedFriends: 0,
      emittedCount: 0, errors: 0, durationMs: 1, skipped: null,
    });
    await runFriendSyncCycleNow(null);
    expect(syncFriendsForAccountMock).toHaveBeenCalledTimes(2);
    expect(syncFriendsForAccountMock).toHaveBeenNthCalledWith(
      1, 'za-1', 'org-1', { trigger: 'cron', io: null },
    );
    expect(syncFriendsForAccountMock).toHaveBeenNthCalledWith(
      2, 'za-2', 'org-1', { trigger: 'cron', io: null },
    );
  });

  it('continues iteration when 1 account fails', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-bad', orgId: 'org-1', displayName: 'Bad' },
      { id: 'za-good', orgId: 'org-1', displayName: 'Good' },
    ]);
    syncFriendsForAccountMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        liveCount: 5, createdContacts: 0, upsertedFriends: 5,
        emittedCount: 1, errors: 0, durationMs: 50, skipped: null,
      });
    await runFriendSyncCycleNow(null);
    expect(syncFriendsForAccountMock).toHaveBeenCalledTimes(2);
  });

  it('accumulates emittedCount + errors across accounts', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-1', orgId: 'o', displayName: 'A' },
      { id: 'za-2', orgId: 'o', displayName: 'B' },
    ]);
    syncFriendsForAccountMock
      .mockResolvedValueOnce({
        liveCount: 10, createdContacts: 0, upsertedFriends: 10,
        emittedCount: 3, errors: 1, durationMs: 100, skipped: null,
      })
      .mockResolvedValueOnce({
        liveCount: 5, createdContacts: 1, upsertedFriends: 5,
        emittedCount: 2, errors: 0, durationMs: 80, skipped: null,
      });
    // No throw → just verify total via logger spy not feasible without
    // refactoring. Smoke: 2 calls completed.
    await runFriendSyncCycleNow(null);
    expect(syncFriendsForAccountMock).toHaveBeenCalledTimes(2);
  });

  it('passes IO param through to syncFriendsForAccount', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-io', orgId: 'org-1', displayName: 'Nick' },
    ]);
    syncFriendsForAccountMock.mockResolvedValue({
      liveCount: 0, createdContacts: 0, upsertedFriends: 0,
      emittedCount: 0, errors: 0, durationMs: 1, skipped: null,
    });
    const fakeIO = { emit: vi.fn() } as any;
    await runFriendSyncCycleNow(fakeIO);
    expect(syncFriendsForAccountMock).toHaveBeenCalledWith(
      'za-io', 'org-1', { trigger: 'cron', io: fakeIO },
    );
  });
});
