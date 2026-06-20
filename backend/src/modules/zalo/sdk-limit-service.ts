// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * sdk-limit-service.ts — 2026-06-06 (Anh chốt).
 * Nguồn TRẦN SDK Zalo (thay CATEGORY_LIMITS hardcode). Cấu hình tại màn "Quản lý
 * tài khoản Zalo". Quy tắc đọc (Anh chốt):
 *   ưu tiên trần GHI ĐÈ của nick → org DEFAULT → fallback hằng số code.
 * Mọi nơi gọi SDK (zalo-rate-limiter) + UI đọc qua service này.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import type { OpCategory } from '../../shared/zalo-operations.js';

export interface CategoryLimit {
  daily: number;
  burst: number;
  burstWindowMs: number;
}

// Fallback CUỐI CÙNG nếu DB chưa cấu hình (= giá trị hardcode lịch sử). KHÔNG còn là
// nguồn chính — chỉ dùng khi org chưa có hàng sdk_limits cho category đó.
export const DEFAULT_SDK_LIMITS: Record<OpCategory, CategoryLimit> = {
  message:       { daily: 200,  burst: 20, burstWindowMs: 30_000 },
  reaction:      { daily: 300,  burst: 10, burstWindowMs: 30_000 },
  chat_action:   { daily: 500,  burst: 15, burstWindowMs: 30_000 },
  group_admin:   { daily: 50,   burst: 5,  burstWindowMs: 60_000 },
  group_read:    { daily: 1000, burst: 20, burstWindowMs: 30_000 },
  friend_action: { daily: 30,   burst: 8,  burstWindowMs: 60_000 },
  friend_read:   { daily: 500,  burst: 10, burstWindowMs: 30_000 }, // online/recommend/sent-req còn lại
  profile:       { daily: 10,   burst: 3,  burstWindowMs: 60_000 },
  query:         { daily: 2000, burst: 30, burstWindowMs: 30_000 },
  // 2026-06-06 (Anh chốt) — tách findUser + đồng bộ danh bạ ra khỏi friend_read.
  // friend_lookup CAO (tìm SĐT→UID là việc chính của chiến dịch, cần nhiều).
  // contact_sync THẤP (đồng bộ danh bạ nền chỉ vài lần/ngày khi reconnect).
  friend_lookup: { daily: 1000, burst: 15, burstWindowMs: 30_000 },
  contact_sync:  { daily: 100,  burst: 5,  burstWindowMs: 60_000 },
};

export const ALL_CATEGORIES = Object.keys(DEFAULT_SDK_LIMITS) as OpCategory[];

// ── Cache: key = `${orgId}:${nickId||'_'}:${category}` → 60s TTL ───────────────
interface CacheEntry { limit: CategoryLimit; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
// nick → orgId (đỡ query lại mỗi lần). TTL dài hơn vì hiếm đổi.
const nickOrgCache = new Map<string, { orgId: string | null; expiresAt: number }>();
const NICK_ORG_TTL_MS = 5 * 60_000;

function cacheKey(orgId: string, nickId: string | null, cat: string): string {
  return `${orgId}:${nickId ?? '_'}:${cat}`;
}

async function resolveOrgId(nickId: string): Promise<string | null> {
  const hit = nickOrgCache.get(nickId);
  if (hit && hit.expiresAt > Date.now()) return hit.orgId;
  let orgId: string | null = null;
  try {
    const nick = await prisma.zaloAccount.findUnique({ where: { id: nickId }, select: { orgId: true } });
    orgId = nick?.orgId ?? null;
  } catch (err) {
    logger.warn(`[sdk-limit] resolveOrgId failed nick=${nickId}:`, err);
  }
  nickOrgCache.set(nickId, { orgId, expiresAt: Date.now() + NICK_ORG_TTL_MS });
  return orgId;
}

/**
 * Trần hiệu lực cho 1 nick + category: nick override → org default → fallback hằng số.
 */
export async function getEffectiveLimit(nickId: string, category: OpCategory): Promise<CategoryLimit> {
  const fallback = DEFAULT_SDK_LIMITS[category] ?? DEFAULT_SDK_LIMITS.message;
  try {
    const orgId = await resolveOrgId(nickId);
    if (!orgId) return fallback;

    const ck = cacheKey(orgId, nickId, category);
    const hit = cache.get(ck);
    if (hit && hit.expiresAt > Date.now()) return hit.limit;

    // 1 query lấy cả override (nick) + default (org) cho category này.
    const rows = await prisma.sdkLimit.findMany({
      where: {
        orgId,
        category,
        OR: [{ zaloAccountId: nickId }, { zaloAccountId: null }],
      },
      select: { zaloAccountId: true, dailyLimit: true, burstLimit: true, burstWindowMs: true },
    });
    const nickRow = rows.find((r) => r.zaloAccountId === nickId);
    const orgRow = rows.find((r) => r.zaloAccountId === null);
    const chosen = nickRow ?? orgRow; // ưu tiên nick, backup org
    const limit: CategoryLimit = chosen
      ? { daily: chosen.dailyLimit, burst: chosen.burstLimit, burstWindowMs: chosen.burstWindowMs }
      : fallback;

    cache.set(ck, { limit, expiresAt: Date.now() + CACHE_TTL_MS });
    return limit;
  } catch (err) {
    logger.warn(`[sdk-limit] getEffectiveLimit failed nick=${nickId} cat=${category}:`, err);
    return fallback;
  }
}

/** Xoá cache (gọi khi admin edit trần). null = xoá tất cả. */
export function invalidateLimitCache(orgId?: string): void {
  if (!orgId) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(`${orgId}:`)) cache.delete(k);
}
