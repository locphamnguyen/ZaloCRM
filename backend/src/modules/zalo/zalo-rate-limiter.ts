// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-rate-limiter.ts — Per-account, per-operation-type rate limiting.
 * Uses Redis when REDIS_URL is set, otherwise in-memory Maps.
 * Fail-open: if checking fails, operations are allowed through.
 */
import type { OpCategory } from '../../shared/zalo-operations.js';
import type { RedisClient } from '../../shared/redis-client.js';
import { getRedis } from '../../shared/redis-client.js';
// 2026-06-06 (Anh chốt) — trần SDK đọc từ DB (cấu hình ở màn Quản lý nick Zalo),
// KHÔNG còn hardcode trong file này.
import { getEffectiveLimit, ALL_CATEGORIES, DEFAULT_SDK_LIMITS, type CategoryLimit } from './sdk-limit-service.js';

interface DailyCounter { count: number; date: string; }

const DAILY_KEY = (acct: string, cat: string) => `rl:daily:${acct}:${cat}`;
const BURST_KEY = (acct: string, cat: string) => `rl:burst:${acct}:${cat}`;

// P7 (D4) — "ngày" tính theo giờ VN (UTC+7, không DST) để bộ đếm daily reset lúc 00:00 VN,
// khớp khung gửi 8h-21h VN. Trước đây dùng toISOString() (UTC) → reset lúc 07:00 sáng VN.
// Dùng CHUNG cho mọi nơi ghi/đọc daily counter (write & read phải cùng key).
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export function vnDayKey(now: number = Date.now()): string {
  return new Date(now + VN_OFFSET_MS).toISOString().split('T')[0];
}

class ZaloRateLimiter {
  private dailyCounts = new Map<string, DailyCounter>();
  private recentSends = new Map<string, number[]>();
  private redis: RedisClient | null = null;
  private redisChecked = false;

  private async getRedisClient(): Promise<RedisClient | null> {
    if (!this.redisChecked) {
      this.redisChecked = true;
      this.redis = await getRedis();
      if (this.redis) console.log('[rate-limiter] Using Redis backing');
    }
    return this.redis;
  }

  async checkLimits(
    accountId: string,
    category: OpCategory = 'message',
    opts?: { failClosed?: boolean },
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // #2026-06-06 (Anh chốt) — trần đọc từ DB (nick override → org default → fallback),
      // KHÔNG còn hardcode CATEGORY_LIMITS. Cache 60s trong sdk-limit-service.
      const eff = await getEffectiveLimit(accountId, category);
      const limits: CategoryLimit = { daily: eff.daily, burst: eff.burst, burstWindowMs: eff.burstWindowMs };
      const r = await this.getRedisClient();

      if (r) return this.checkRedis(r, accountId, category, limits);
      return this.checkMemory(accountId, category, limits);
    } catch {
      // P5 (D1) — fail-CLOSED cho luồng automation hàng loạt (opts.failClosed): khi limiter
      // (Redis/Postgres) lỗi → CHẶN, không "xả" tin vượt trần đúng lúc hạ tầng sự cố (spam/
      // khoá nick). Mặc định fail-OPEN: thao tác tay đơn lẻ của sale không bị chặn oan khi
      // limiter chập chờn.
      if (opts?.failClosed) return { allowed: false, reason: 'limiter_unavailable' };
      return { allowed: true };
    }
  }

  private checkMemory(accountId: string, category: OpCategory, limits: CategoryLimit): { allowed: boolean; reason?: string } {
    const key = `${accountId}:${category}`;
    const today = vnDayKey();

    const daily = this.dailyCounts.get(key);
    if (daily && daily.date === today && daily.count >= limits.daily) {
      return { allowed: false, reason: `Đã đạt giới hạn ${limits.daily} ${category}/ngày` };
    }

    const now = Date.now();
    const recent = (this.recentSends.get(key) || []).filter(t => now - t < limits.burstWindowMs);
    if (recent.length >= limits.burst) {
      return { allowed: false, reason: `Quá nhanh (>${limits.burst} ${category}/${Math.round(limits.burstWindowMs / 1000)}s)` };
    }
    return { allowed: true };
  }

  private async checkRedis(r: RedisClient, accountId: string, category: OpCategory, limits: CategoryLimit): Promise<{ allowed: boolean; reason?: string }> {
    const today = vnDayKey();
    const dailyKey = DAILY_KEY(accountId, category);
    const dailyVal = await r.hget(dailyKey, today);
    const dailyCount = dailyVal ? parseInt(dailyVal, 10) : 0;

    if (dailyCount >= limits.daily) {
      return { allowed: false, reason: `Đã đạt giới hạn ${limits.daily} ${category}/ngày` };
    }

    const burstKey = BURST_KEY(accountId, category);
    const now = Date.now();
    await r.zremrangebyscore(burstKey, '-inf', String(now - limits.burstWindowMs));
    const burstCount = await r.zcard(burstKey);

    if (burstCount >= limits.burst) {
      return { allowed: false, reason: `Quá nhanh (>${limits.burst} ${category}/${Math.round(limits.burstWindowMs / 1000)}s)` };
    }
    return { allowed: true };
  }

  async recordSend(accountId: string, category: OpCategory = 'message'): Promise<void> {
    const r = await this.getRedisClient();
    if (r) {
      try {
        const today = vnDayKey();
        const dailyKey = DAILY_KEY(accountId, category);
        await r.hincrby(dailyKey, today, 1);
        await r.expire(dailyKey, 86400 * 2);

        const burstKey = BURST_KEY(accountId, category);
        const now = Date.now();
        await r.zadd(burstKey, String(now), `${now}`);
        await r.pexpire(burstKey, 120_000);
        return;
      } catch { /* fall through to in-memory */ }
    }

    const key = `${accountId}:${category}`;
    const now = Date.now();
    const today = vnDayKey();

    const recent = (this.recentSends.get(key) || []).filter(t => now - t < 60_000);
    recent.push(now);
    this.recentSends.set(key, recent);

    const daily = this.dailyCounts.get(key);
    if (daily && daily.date === today) daily.count++;
    else this.dailyCounts.set(key, { count: 1, date: today });
  }

  // 2026-06-06 — đếm OPERATION-LEVEL riêng (vd 'contact_sync' = getAllFriends) cho dashboard.
  // Không ảnh hưởng rate-limit (chỉ là counter metric). Key: rl:op:<acct>:<op>.
  async recordOperation(accountId: string, op: string): Promise<void> {
    const r = await this.getRedisClient();
    if (!r) return;
    try {
      const today = vnDayKey();
      const key = `rl:op:${accountId}:${op}`;
      await r.hincrby(key, today, 1);
      await r.expire(key, 86400 * 9); // giữ ~9 ngày cho sparkline 7 ngày
    } catch { /* metric best-effort */ }
  }

  async getOperationCount(accountId: string, op: string): Promise<number> {
    const r = await this.getRedisClient();
    if (!r) return 0;
    try {
      const today = vnDayKey();
      const val = await r.hget(`rl:op:${accountId}:${op}`, today);
      return val ? parseInt(val, 10) : 0;
    } catch { return 0; }
  }

  async getDailyCount(accountId: string, category: OpCategory = 'message'): Promise<number> {
    const r = await this.getRedisClient();
    if (r) {
      try {
        const today = vnDayKey();
        const val = await r.hget(DAILY_KEY(accountId, category), today);
        return val ? parseInt(val, 10) : 0;
      } catch { /* fall through */ }
    }

    const key = `${accountId}:${category}`;
    const today = vnDayKey();
    const daily = this.dailyCounts.get(key);
    return daily && daily.date === today ? daily.count : 0;
  }

  async getAllDailyCounts(accountId: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const cat of ALL_CATEGORIES) {
      result[cat] = await this.getDailyCount(accountId, cat as OpCategory);
    }
    return result;
  }

  /** @deprecated trần thật giờ per-nick từ DB (sdk-limit-service.getEffectiveLimit).
   *  Hàm này chỉ trả fallback hằng số, giữ cho backward-compat. */
  getLimitsConfig(): Record<string, CategoryLimit> {
    return { ...DEFAULT_SDK_LIMITS };
  }
}

export const zaloRateLimiter = new ZaloRateLimiter();
