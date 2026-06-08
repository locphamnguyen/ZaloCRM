/**
 * care-session-service.test.ts — Unit test CareSession (Phiên chăm sóc).
 *
 * Phủ các quyết định eng-review (D9 test đầy đủ):
 *  - isListeningState (D12): active+paused = nghe; completed/cancelled = đóng
 *  - buildCareEventId (S2): phân tán, providerId vs timestamp-bucket
 *  - findListeningSessionsForEvent: lazy-close nguồn chết (D12), giữ paused
 *  - recordCustomerEventOnSession: idempotent reply 2 lần (D4) — P2002 → false
 *  - sweepSilentCareSessions: janitor set-based + race guard (S1)
 *  - closeCareSessionsOnConditionMatch: đóng theo status/tag trong closeConditions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  careSession: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  careSessionEvent: {
    create: vi.fn(),
  },
  automationTrigger: { findUnique: vi.fn() },
  automationSequence: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/automation/queues/sequence-step-worker.js', () => ({
  enqueueSequenceStart: vi.fn(),
}));

const {
  isListeningState,
  buildCareEventId,
  findListeningSessionsForEvent,
  recordCustomerEventOnSession,
  sweepSilentCareSessions,
  closeCareSessionsOnConditionMatch,
} = await import('../src/modules/automation/care-session/care-session-service.ts');

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe('isListeningState (D12 — paused VẪN nghe)', () => {
  it('active + paused = đang nghe', () => {
    expect(isListeningState('active')).toBe(true);
    expect(isListeningState('paused')).toBe(true);
  });
  it('completed/cancelling/cancelled = nguồn chết, không nghe', () => {
    expect(isListeningState('completed')).toBe(false);
    expect(isListeningState('cancelling')).toBe(false);
    expect(isListeningState('cancelled')).toBe(false);
    expect(isListeningState('draft')).toBe(false);
  });
  it('null/undefined = không nghe', () => {
    expect(isListeningState(null)).toBe(false);
    expect(isListeningState(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('buildCareEventId (S2 — phân tán)', () => {
  it('dùng providerId khi có (reply/reaction)', () => {
    const id = buildCareEventId({
      nickId: 'nick1', contactId: 'c1', eventType: 'reply', providerId: 'msg-abc',
    });
    expect(id).toBe('nick1:c1:reply:msg-abc');
  });
  it('fallback timestamp-bucket 60s khi không có providerId (friend events)', () => {
    const id1 = buildCareEventId({
      nickId: 'nick1', contactId: 'c1', eventType: 'blocked', timestampMs: 90_000,
    });
    const id2 = buildCareEventId({
      nickId: 'nick1', contactId: 'c1', eventType: 'blocked', timestampMs: 110_000,
    });
    // 90s và 110s cùng bucket (60s..120s → bucket 1) → dedup được event trùng trong cửa sổ
    expect(id1).toBe('nick1:c1:blocked:t1');
    expect(id2).toBe('nick1:c1:blocked:t1');
  });
  it('bucket khác nhau khi cách > 60s', () => {
    const a = buildCareEventId({ nickId: 'n', contactId: 'c', eventType: 'blocked', timestampMs: 30_000 });
    const b = buildCareEventId({ nickId: 'n', contactId: 'c', eventType: 'blocked', timestampMs: 130_000 });
    expect(a).not.toBe(b); // t0 vs t2
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('findListeningSessionsForEvent (D12 lazy-close)', () => {
  it('trigger active → nghe; trigger completed → lazy-close + loại khỏi kết quả', async () => {
    prismaMock.careSession.findMany.mockResolvedValue([
      { id: 's1', orgId: 'o1', ownerUserId: 'u1', enrolledByUserId: null, sourceType: 'trigger',
        sourceTriggerId: 't1', sourceSequenceId: null, trigger: { state: 'active', name: 'A' } },
      { id: 's2', orgId: 'o1', ownerUserId: 'u1', enrolledByUserId: null, sourceType: 'trigger',
        sourceTriggerId: 't2', sourceSequenceId: null, trigger: { state: 'completed', name: 'B' } },
    ]);
    prismaMock.careSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await findListeningSessionsForEvent({ orgId: 'o1', contactId: 'c1', nickId: 'n1' });

    // Chỉ s1 (active) còn nghe; s2 (completed) bị lazy-close.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
    // s2 được updateMany đóng với reason source_done.
    expect(prismaMock.careSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['s2'] } }),
        data: expect.objectContaining({ state: 'closed', closedReason: 'source_done' }),
      }),
    );
  });

  it('trigger PAUSED → VẪN nghe (D12 không đóng)', async () => {
    prismaMock.careSession.findMany.mockResolvedValue([
      { id: 's1', orgId: 'o1', ownerUserId: 'u1', enrolledByUserId: null, sourceType: 'trigger',
        sourceTriggerId: 't1', sourceSequenceId: null, trigger: { state: 'paused', name: 'A' } },
    ]);
    const result = await findListeningSessionsForEvent({ orgId: 'o1', contactId: 'c1', nickId: 'n1' });
    expect(result).toHaveLength(1);
    expect(prismaMock.careSession.updateMany).not.toHaveBeenCalled();
  });

  it('phiên gắn tay (sourceTriggerId=null, không trigger) → luôn nghe', async () => {
    prismaMock.careSession.findMany.mockResolvedValue([
      { id: 'sm', orgId: 'o1', ownerUserId: 'u1', enrolledByUserId: 'mgr', sourceType: 'sequence_manual',
        sourceTriggerId: null, sourceSequenceId: 'seq1', trigger: null },
    ]);
    const result = await findListeningSessionsForEvent({ orgId: 'o1', contactId: 'c1', nickId: 'n1' });
    expect(result).toHaveLength(1);
    expect(result[0].triggerState).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('recordCustomerEventOnSession (D4 idempotent)', () => {
  it('event mới → true (cần pause+notify)', async () => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<void>) => {
      await fn(prismaMock);
    });
    prismaMock.careSessionEvent.create.mockResolvedValue({ id: 'e1' });
    prismaMock.careSession.update.mockResolvedValue({});

    const isNew = await recordCustomerEventOnSession({
      sessionId: 's1', eventId: 'n1:c1:reply:m1', eventType: 'reply',
    });
    expect(isNew).toBe(true);
  });

  it('reply 2 lần (P2002 unique) → false (dup, bỏ qua) — KHÔNG double-pause', async () => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<void>) => {
      await fn(prismaMock);
    });
    prismaMock.careSessionEvent.create.mockRejectedValue({ code: 'P2002' });

    const isNew = await recordCustomerEventOnSession({
      sessionId: 's1', eventId: 'n1:c1:reply:m1', eventType: 'reply',
    });
    expect(isNew).toBe(false);
  });

  it('lỗi khác P2002 → throw (không nuốt)', async () => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<void>) => {
      await fn(prismaMock);
    });
    prismaMock.careSessionEvent.create.mockRejectedValue({ code: 'P9999', message: 'boom' });

    await expect(
      recordCustomerEventOnSession({ sessionId: 's1', eventId: 'x', eventType: 'reply' }),
    ).rejects.toMatchObject({ code: 'P9999' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('sweepSilentCareSessions (T6 janitor + S1 race guard)', () => {
  it('đóng set-based với WHERE state+window+lastActivity<tickStart', async () => {
    prismaMock.careSession.updateMany.mockResolvedValue({ count: 3 });
    const r = await sweepSilentCareSessions();
    expect(r.closed).toBe(3);
    const call = prismaMock.careSession.updateMany.mock.calls[0][0];
    expect(call.where.state).toBe('active');
    expect(call.where.interestWindowUntil).toHaveProperty('lte');
    // S1 race guard: OR null hoặc < tickStart
    expect(call.where.OR).toBeDefined();
    expect(call.data.closedReason).toBe('janitor_silence');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('closeCareSessionsOnConditionMatch (T7 event-driven close)', () => {
  it('đạt status trong closeConditions.onStatusIds → đóng phiên đó', async () => {
    prismaMock.careSession.findMany.mockResolvedValue([
      { id: 's1', closeConditions: { onStatusIds: ['st-chot', 'st-fail'] } },
      { id: 's2', closeConditions: { onStatusIds: ['st-khac'] } },
    ]);
    prismaMock.careSession.updateMany.mockResolvedValue({ count: 1 });

    const r = await closeCareSessionsOnConditionMatch({
      orgId: 'o1', contactId: 'c1', matchKind: 'status', matchedId: 'st-chot',
    });
    expect(r.closed).toBe(1);
    // chỉ s1 (chứa st-chot) bị đóng, s2 không.
    expect(prismaMock.careSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['s1'] } }) }),
    );
  });

  it('không status nào khớp → không đóng', async () => {
    prismaMock.careSession.findMany.mockResolvedValue([
      { id: 's1', closeConditions: { onStatusIds: ['st-khac'] } },
    ]);
    const r = await closeCareSessionsOnConditionMatch({
      orgId: 'o1', contactId: 'c1', matchKind: 'status', matchedId: 'st-chot',
    });
    expect(r.closed).toBe(0);
    expect(prismaMock.careSession.updateMany).not.toHaveBeenCalled();
  });

  it('phiên không có closeConditions → bỏ qua', async () => {
    prismaMock.careSession.findMany.mockResolvedValue([
      { id: 's1', closeConditions: null },
    ]);
    const r = await closeCareSessionsOnConditionMatch({
      orgId: 'o1', contactId: 'c1', matchKind: 'friendTag', matchedId: 'tag1',
    });
    expect(r.closed).toBe(0);
  });
});
