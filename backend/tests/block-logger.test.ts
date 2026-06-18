// Unit test — block-logger (chống flood SET NX + clearBlockMarker). NV-1 eng-review.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bắt logEvent (không đụng DB).
const logEventMock = vi.fn();
vi.mock('../src/modules/automation/friend-invite/event-log-service.js', () => ({
  logEvent: (...a: unknown[]) => logEventMock(...a),
}));
// Không cần Redis thật — test luôn truyền redis giả.
vi.mock('../src/modules/automation/queues/redis-connection.js', () => ({
  getBullMQRedis: () => { throw new Error('test phải truyền redis'); },
}));

import { logBlockOnce, clearBlockMarker } from '../src/modules/automation/shared/block-logger.js';

// Redis giả: emulate SET ... NX (key tồn tại → null) + DEL nhiều key.
function makeFakeRedis() {
  const store = new Map<string, string>();
  const calls: unknown[][] = [];
  const redis = {
    store,
    calls,
    async set(key: string, val: string, ...args: unknown[]) {
      calls.push(['set', key, val, ...args]);
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
    async del(...keys: string[]) {
      calls.push(['del', ...keys]);
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
  };
  return redis;
}

const base = { orgId: 'o1', triggerId: 't1', contactId: 'c1', reason: 'outside_hour_window' };

describe('logBlockOnce — chống flood + ghi đúng event', () => {
  beforeEach(() => logEventMock.mockClear());

  it('lần đầu → SET NX OK → ghi 1 event + trả true', async () => {
    const redis = makeFakeRedis();
    const ok = await logBlockOnce({ ...base, redis: redis as never });
    expect(ok).toBe(true);
    expect(logEventMock).toHaveBeenCalledTimes(1);
    const arg = logEventMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.eventType).toBe('sequence_step_blocked'); // outside_hour_window = defer
    expect(arg.category).toBe('outside_hour_window');
    expect(arg.summary).toBe('Ngoài giờ gửi');
  });

  it('lần 2 cùng key (marker còn sống) → KHÔNG ghi + trả false', async () => {
    const redis = makeFakeRedis();
    await logBlockOnce({ ...base, redis: redis as never });
    logEventMock.mockClear();
    const ok2 = await logBlockOnce({ ...base, redis: redis as never });
    expect(ok2).toBe(false);
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it('sau clearBlockMarker → ghi LẠI được (NV-1 không nuốt log)', async () => {
    const redis = makeFakeRedis();
    await logBlockOnce({ ...base, redis: redis as never });
    await clearBlockMarker('t1', 'c1', { redis: redis as never });
    logEventMock.mockClear();
    const ok = await logBlockOnce({ ...base, redis: redis as never });
    expect(ok).toBe(true);
    expect(logEventMock).toHaveBeenCalledTimes(1);
  });

  it('skip-hẳn (multi_nick) → eventType sequence_step_skipped + TTL cố định', async () => {
    const redis = makeFakeRedis();
    await logBlockOnce({ ...base, reason: 'multi_nick (3 >= threshold 2)', redis: redis as never });
    const arg = logEventMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.eventType).toBe('sequence_step_skipped');
    const setCall = redis.calls.find((c) => c[0] === 'set')!;
    expect(setCall).toContain('EX');
    expect(setCall).toContain('NX');
  });

  it('có nextRunAt → TTL ~ thời gian tới nextRunAt (≥60s)', async () => {
    const redis = makeFakeRedis();
    const nextRunAt = new Date(Date.now() + 2 * 3600_000); // 2h sau
    await logBlockOnce({ ...base, nextRunAt, redis: redis as never });
    const setCall = redis.calls.find((c) => c[0] === 'set')!;
    const exIdx = setCall.indexOf('EX');
    const ttl = setCall[exIdx + 1] as number;
    expect(ttl).toBeGreaterThan(3600);
    expect(ttl).toBeLessThanOrEqual(2 * 3600 + 5);
  });

  it('khác category KHÔNG nuốt nhau (key theo category)', async () => {
    const redis = makeFakeRedis();
    await logBlockOnce({ ...base, reason: 'outside_hour_window', redis: redis as never });
    logEventMock.mockClear();
    const ok = await logBlockOnce({ ...base, reason: 'nick_offline', redis: redis as never });
    expect(ok).toBe(true); // category khác → marker khác → vẫn ghi
    expect(logEventMock).toHaveBeenCalledTimes(1);
  });
});

describe('clearBlockMarker', () => {
  it('không có category → xoá theo danh sách tất cả category', async () => {
    const redis = makeFakeRedis();
    await clearBlockMarker('t1', 'c1', { redis: redis as never });
    const delCall = redis.calls.find((c) => c[0] === 'del')!;
    // del nhiều key (mỗi category 1 key)
    expect(delCall.length).toBeGreaterThan(5);
    expect(delCall.every((k, i) => i === 0 || (k as string).startsWith('evtlog:block:t1:c1:'))).toBe(true);
  });
});
