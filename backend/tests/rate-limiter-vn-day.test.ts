/**
 * rate-limiter-vn-day.test.ts — P7 (D4) regression.
 * "Ngày" của bộ đếm daily phải theo giờ VN (UTC+7): reset lúc 00:00 VN = 17:00 UTC.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/modules/zalo/sdk-limit-service.js', () => ({
  getEffectiveLimit: vi.fn(), ALL_CATEGORIES: [], DEFAULT_SDK_LIMITS: {},
}));
vi.mock('../src/shared/redis-client.js', () => ({ getRedis: vi.fn().mockResolvedValue(null) }));

const { vnDayKey } = await import('../src/modules/zalo/zalo-rate-limiter.js');

describe('vnDayKey (P7)', () => {
  it('16:59 UTC vẫn là ngày VN cũ (trước nửa đêm VN)', () => {
    expect(vnDayKey(Date.parse('2026-07-07T16:59:00Z'))).toBe('2026-07-07');
  });

  it('17:00 UTC = 00:00 VN ngày mới → chuyển sang ngày VN kế tiếp', () => {
    expect(vnDayKey(Date.parse('2026-07-07T17:00:00Z'))).toBe('2026-07-08');
  });

  it('khác giờ UTC nhưng cùng ngày VN → cùng key', () => {
    const a = vnDayKey(Date.parse('2026-07-07T17:30:00Z')); // 00:30 VN 08/07
    const b = vnDayKey(Date.parse('2026-07-08T10:00:00Z')); // 17:00 VN 08/07
    expect(a).toBe('2026-07-08');
    expect(b).toBe('2026-07-08');
  });
});
