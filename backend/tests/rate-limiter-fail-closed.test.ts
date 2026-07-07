/**
 * rate-limiter-fail-closed.test.ts — P5 (D1) regression.
 * Khi limiter lỗi (Redis/Postgres): mặc định fail-OPEN (thao tác tay của sale không bị
 * chặn oan), nhưng luồng automation gọi { failClosed: true } phải fail-CLOSED (dừng gửi
 * để không spam vượt trần lúc hạ tầng sự cố).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/modules/zalo/sdk-limit-service.js', () => ({
  // Ép nhánh catch của checkLimits: getEffectiveLimit ném lỗi (mô phỏng Redis/DB sập).
  getEffectiveLimit: vi.fn().mockRejectedValue(new Error('limiter backend down')),
  ALL_CATEGORIES: ['message', 'friend_action', 'friend_lookup'],
  DEFAULT_SDK_LIMITS: {},
}));
vi.mock('../src/shared/redis-client.js', () => ({ getRedis: vi.fn().mockResolvedValue(null) }));

const { zaloRateLimiter } = await import('../src/modules/zalo/zalo-rate-limiter.js');

describe('rate-limiter fail-closed (P5)', () => {
  it('mặc định fail-OPEN khi limiter lỗi (thao tác tay của sale)', async () => {
    const res = await zaloRateLimiter.checkLimits('nick-1', 'message');
    expect(res.allowed).toBe(true);
  });

  it('failClosed:true → fail-CLOSED khi limiter lỗi (luồng automation)', async () => {
    const res = await zaloRateLimiter.checkLimits('nick-1', 'friend_action', { failClosed: true });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('limiter_unavailable');
  });
});
