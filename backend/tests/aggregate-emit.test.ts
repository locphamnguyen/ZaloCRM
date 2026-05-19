/**
 * aggregate-emit.test.ts — REGRESSION test cho applyFriendAggregate emit friend:updated.
 *
 * 3 critical cases:
 *  1. First message → Friend created → emit với relationshipKind+hasConversation
 *  2. Existing Friend, zaloDisplayName change → emit chỉ field đổi
 *  3. Existing Friend, chỉ increment totalInbound (không identity change) → SKIP emit
 *
 * Nếu test này fail → backend đã break socket live update contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ioToMock = { emit: vi.fn() };
const ioMock = {
  to: vi.fn(() => ioToMock),
  emit: vi.fn(),
};

const prismaMock = {
  conversation: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/zalo/friend-event-handler.js', () => ({
  counterDelta: vi.fn().mockReturnValue({ accepted: 0, pending: 0, chatting: 0 }),
  deriveRelationshipKind: vi.fn().mockReturnValue('friend'),
}));
vi.mock('../src/modules/activity/activity-logger.js', () => ({
  logActivity: vi.fn(),
}));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getIO: vi.fn(() => ioMock) },
}));

const { applyFriendAggregate } = await import('../src/modules/contacts/contact-aggregate.ts');

const BASE_CONV = {
  contactId: 'c1',
  zaloAccountId: 'za1',
  threadType: 'user',
  orgId: 'org-1',
  externalThreadId: 'uid-kh',
};

const BASE_INPUT = {
  conversationId: 'conv-1',
  message: {
    id: 'msg-1',
    content: 'Hi',
    contentType: 'text',
    sentAt: new Date('2026-05-19T10:00:00Z'),
    senderType: 'contact' as const,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  ioToMock.emit.mockClear();
  ioMock.to.mockClear();
});

describe('applyFriendAggregate — emit friend:updated', () => {
  it('emits when first message creates Friend row', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(BASE_CONV);
    // Simulate $transaction callback executing with mock tx
    prismaMock.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        friend: {
          findUnique: vi.fn().mockResolvedValue(null), // no existing
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn(),
        },
        contact: {
          update: vi.fn(),
        },
      };
      await cb(tx);
    });

    await applyFriendAggregate({
      ...BASE_INPUT,
      contactZaloDisplayName: 'KH An',
      contactZaloAvatarUrl: 'http://a.png',
    });

    expect(ioMock.to).toHaveBeenCalledWith('org:org-1');
    expect(ioToMock.emit).toHaveBeenCalledWith(
      'friend:updated',
      expect.objectContaining({
        contactId: 'c1',
        zaloAccountId: 'za1',
        patch: expect.objectContaining({
          relationshipKind: 'chatting_stranger',
          hasConversation: true,
        }),
      }),
    );
  });

  it('emits with zaloDisplayName patch when KH đổi tên Zalo', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(BASE_CONV);
    prismaMock.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        friend: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'f-existing',
            zaloDisplayName: 'Tên Cũ',
            zaloAvatarUrl: null,
            lastInboundAt: new Date('2026-05-19T08:00:00Z'),
            lastOutboundAt: null,
            hasConversation: true,
            friendshipStatus: 'accepted',
            relationshipKind: 'friend',
            firstMessageAt: new Date('2026-05-19T07:00:00Z'),
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        contact: { update: vi.fn() },
      };
      await cb(tx);
    });

    await applyFriendAggregate({
      ...BASE_INPUT,
      contactZaloDisplayName: 'Tên Mới',  // đổi
      contactZaloAvatarUrl: null,
    });

    const emittedPayload = ioToMock.emit.mock.calls[0]?.[1] as any;
    expect(emittedPayload?.patch).toHaveProperty('zaloDisplayName', 'Tên Mới');
    // KHÔNG emit lastInboundAt / totalInbound (avoid spam mỗi message)
    expect(emittedPayload?.patch).not.toHaveProperty('lastInboundAt');
    expect(emittedPayload?.patch).not.toHaveProperty('totalInbound');
  });

  it('SKIPS emit when chỉ counter increment, không identity change', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(BASE_CONV);
    prismaMock.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        friend: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'f-existing',
            zaloDisplayName: 'Tên Đúng',
            zaloAvatarUrl: 'http://a.png',
            lastInboundAt: new Date('2026-05-19T08:00:00Z'),
            lastOutboundAt: null,
            hasConversation: true,  // không flip
            friendshipStatus: 'accepted',
            relationshipKind: 'friend',
            firstMessageAt: new Date('2026-05-19T07:00:00Z'),
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        contact: { update: vi.fn() },
      };
      await cb(tx);
    });

    await applyFriendAggregate({
      ...BASE_INPUT,
      contactZaloDisplayName: 'Tên Đúng',  // không đổi
      contactZaloAvatarUrl: 'http://a.png',  // không đổi
    });

    // Counter incremented nhưng identity không drift → KHÔNG emit
    expect(ioToMock.emit).not.toHaveBeenCalled();
  });
});
