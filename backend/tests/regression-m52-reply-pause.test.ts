/**
 * regression-m52-reply-pause.test.ts — M16 smoke regression.
 *
 * Bảo vệ luồng M52 (customer_reply → pause N giờ + cancel jobs):
 *   - Khi customer reply giữa luồng → setContactPauseFlag với hours từ trigger config
 *   - automationEventLog.create eventType='customer_reply'
 *   - Redis set key `contact:paused:${triggerId}:${contactId}` với TTL = hours*3600*1000ms
 *
 * Smoke level: mock prisma + redis + queue, KHÔNG cần DB thật.
 * Reference: backend/src/modules/automation/queues/event-hooks.ts (onCustomerReply).
 * Memory: M52 chốt 2026-06-01 — pauseOnActivityHours config per-trigger (default 24h).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted BEFORE import target) ──────────────────────────────────
const prismaMock = {
  automationTrigger: { findUnique: vi.fn() },
  automationEventLog: { create: vi.fn(), findFirst: vi.fn() },
  automationSequence: { findUnique: vi.fn() },
  contact: { findUnique: vi.fn(), update: vi.fn() },
  zaloAccount: { findUnique: vi.fn() },
};
const redisMock = {
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  pttl: vi.fn().mockResolvedValue(0),
};
// T4 2026-06-07 (R1): cancelPendingStepsForContact đổi getJobs(1000) full-scan →
// getJob(jobId) trực tiếp theo deterministic jobId. Mock cả 2 (getJobs giữ cho
// các caller cũ, getJob cho hành vi mới).
const queueMock = {
  getJobs: vi.fn().mockResolvedValue([]),
  getJob: vi.fn().mockResolvedValue(null),
};
const notifyCustomerReplyMock = vi.fn().mockResolvedValue(undefined);
const enqueueSequenceStartMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/automation/queues/redis-connection.js', () => ({
  getBullMQRedis: () => redisMock,
}));
vi.mock('../src/modules/automation/queues/queue-registry.js', () => ({
  getSequenceStepQueue: () => queueMock,
  buildSequenceStepJobId: (t: string, c: string, i: number) => `${t}-${c}-${i}`,
}));
vi.mock('../src/modules/automation/queues/internal-notify-worker.js', () => ({
  notifyFriendAccept: vi.fn(),
  notifyFriendReject: vi.fn(),
  notifyCustomerReply: notifyCustomerReplyMock,
}));
vi.mock('../src/modules/automation/queues/sequence-step-worker.js', () => ({
  enqueueSequenceStart: enqueueSequenceStartMock,
}));

const { onCustomerReply } = await import(
  '../src/modules/automation/queues/event-hooks.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.set.mockResolvedValue('OK');
  queueMock.getJobs.mockResolvedValue([]);
  queueMock.getJob.mockResolvedValue(null);
  prismaMock.contact.findUnique.mockResolvedValue({
    id: 'c1', fullName: 'KH Test', phone: '0901', leadScore: 50,
  });
  prismaMock.zaloAccount.findUnique.mockResolvedValue({
    id: 'n1', displayName: 'Nick A', ownerUserId: 'u1',
  });
  prismaMock.automationEventLog.findFirst.mockResolvedValue(null);
  prismaMock.automationSequence.findUnique.mockResolvedValue({ name: 'Seq A' });
});

describe('M52 — customer_reply → pause + cancel jobs', () => {
  it('sets pause flag với hours từ trigger.pauseOnActivityHours (24h)', async () => {
    prismaMock.automationTrigger.findUnique.mockResolvedValue({
      id: 't1', name: 'Trig A', pauseOnActivityHours: 24, sequenceId: 's1',
    });

    await onCustomerReply({
      orgId: 'org1', triggerId: 't1', contactId: 'c1',
      nickId: 'n1', replyText: 'Em quan tâm',
    });

    // Assert redis set called with PX = 24h
    expect(redisMock.set).toHaveBeenCalledWith(
      'contact:paused:t1:c1', '1', 'PX', 24 * 3600 * 1000,
    );

    // Assert event log created với eventType customer_reply
    expect(prismaMock.automationEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'customer_reply',
          triggerId: 't1',
          contactId: 'c1',
        }),
      }),
    );

    // T4 (R1): cancel attempted qua getJob theo jobId (KHÔNG còn getJobs full-scan).
    expect(queueMock.getJob).toHaveBeenCalled();
  });

  it('honours custom pauseOnActivityHours (vd 48h)', async () => {
    prismaMock.automationTrigger.findUnique.mockResolvedValue({
      id: 't2', name: 'Trig B', pauseOnActivityHours: 48, sequenceId: null,
    });

    await onCustomerReply({
      orgId: 'org1', triggerId: 't2', contactId: 'c2',
      nickId: 'n1', replyText: 'OK',
    });

    expect(redisMock.set).toHaveBeenCalledWith(
      'contact:paused:t2:c2', '1', 'PX', 48 * 3600 * 1000,
    );
  });

  it('no-op khi trigger không tồn tại (early return)', async () => {
    prismaMock.automationTrigger.findUnique.mockResolvedValue(null);

    await onCustomerReply({
      orgId: 'org1', triggerId: 'ghost', contactId: 'c1',
      nickId: 'n1', replyText: 'X',
    });

    expect(redisMock.set).not.toHaveBeenCalled();
    expect(prismaMock.automationEventLog.create).not.toHaveBeenCalled();
  });

  it('fires KHẨN notify khi nick có ownerUserId', async () => {
    prismaMock.automationTrigger.findUnique.mockResolvedValue({
      id: 't1', name: 'Trig A', pauseOnActivityHours: 24, sequenceId: 's1',
    });

    await onCustomerReply({
      orgId: 'org1', triggerId: 't1', contactId: 'c1',
      nickId: 'n1', replyText: 'Em quan tâm dự án',
    });

    expect(notifyCustomerReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: 'u1', triggerId: 't1', contactId: 'c1',
        replyPreview: 'Em quan tâm dự án',
      }),
    );
  });
});
