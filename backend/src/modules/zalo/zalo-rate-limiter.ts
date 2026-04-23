/**
 * zalo-rate-limiter.ts — Per-account, per-operation-type rate limiting.
 * Uses Redis when REDIS_URL is set, otherwise in-memory Maps.
 * Fail-open: if checking fails, operations are allowed through.
 */
import type { OpCategory } from '../../shared/zalo-operations.js';
import type { RedisClient } from '../../shared/redis-client.js';
import { getRedis } from '../../shared/redis-client.js';

interface CategoryLimit {
  daily: number;
  burst: number;
  burstWindowMs: number;
}

const CATEGORY_LIMITS: Record<OpCategory, CategoryLimit> = {
  message:       { daily: 200,  burst: 5,  burstWindowMs: 30_000 },
  reaction:      { daily: 300,  burst: 10, burstWindowMs: 30_000 },
  chat_action:   { daily: 500,  burst: 15, burstWindowMs: 30_000 },
  group_admin:   { daily: 50,   burst: 5,  burstWindowMs: 60_000 },
  group_read:    { daily: 1000, burst: 20, burstWindowMs: 30_000 },
  friend_action: { daily: 30,   burst: 3,  burstWindowMs: 60_000 },
  friend_read:   { daily: 500,  burst: 10, burstWindowMs: 30_000 },
  profile:       { daily: 10,   burst: 3,  burstWindowMs: 60_000 },
  query:         { daily: 2000, burst: 30, burstWindowMs: 30_000 },
};

interface DailyCounter { count: number; date: string; }

const DAILY_KEY = (acct: string, cat: string) => `rl:daily:${acct}:${cat}`;
const BURST_KEY = (acct: string, cat: string) => `rl:burst:${acct}:${cat}`;

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

  async checkLimits(accountId: string, category: OpCategory = 'message'): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const limits = CATEGORY_LIMITS[category] || CATEGORY_LIMITS.message;
      const r = await this.getRedisClient();

      if (r) return this.checkRedis(r, accountId, category, limits);
      return this.checkMemory(accountId, category, limits);
    } catch {
      return { allowed: true };
    }
  }

  private checkMemory(accountId: string, category: OpCategory, limits: CategoryLimit): { allowed: boolean; reason?: string } {
    const key = `${accountId}:${category}`;
    const today = new Date().toISOString().split('T')[0];

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
    const today = new Date().toISOString().split('T')[0];
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
        const today = new Date().toISOString().split('T')[0];
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
    const today = new Date().toISOString().split('T')[0];

    const recent = (this.recentSends.get(key) || []).filter(t => now - t < 60_000);
    recent.push(now);
    this.recentSends.set(key, recent);

    const daily = this.dailyCounts.get(key);
    if (daily && daily.date === today) daily.count++;
    else this.dailyCounts.set(key, { count: 1, date: today });
  }

  async getDailyCount(accountId: string, category: OpCategory = 'message'): Promise<number> {
    const r = await this.getRedisClient();
    if (r) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const val = await r.hget(DAILY_KEY(accountId, category), today);
        return val ? parseInt(val, 10) : 0;
      } catch { /* fall through */ }
    }

    const key = `${accountId}:${category}`;
    const today = new Date().toISOString().split('T')[0];
    const daily = this.dailyCounts.get(key);
    return daily && daily.date === today ? daily.count : 0;
  }

  async getAllDailyCounts(accountId: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const cat of Object.keys(CATEGORY_LIMITS)) {
      result[cat] = await this.getDailyCount(accountId, cat as OpCategory);
    }
    return result;
  }

  getLimitsConfig(): Record<string, CategoryLimit> {
    return { ...CATEGORY_LIMITS };
  }
}

export const zaloRateLimiter = new ZaloRateLimiter();
