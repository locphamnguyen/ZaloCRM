// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * lead-routing.service.ts — Resolve campaign name → CustomerList qua #KEY parsing.
 *
 * Eng review Issue 11: regex case-insensitive lấy #KEY CUỐI CÙNG trong tên.
 *   /#([a-zA-Z0-9-]+)(?=[^#]*$)/
 *
 * Hot path. Mỗi lead về phải resolve trong < 50ms. Cache campaign_id → listId
 * qua meta-campaign-cache.service.ts (TTL 5p — Issue 5).
 *
 * Unrouted fallback: tự tạo CustomerList "🚨 Unrouted FB" lần đầu / org, lưu vào
 * cache để các lead sau cùng vào.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getCachedCampaign, setCachedCampaign } from './meta-campaign-cache.service.js';

const KEY_REGEX = /#([a-zA-Z0-9-]+)(?=[^#]*$)/;

export interface RoutingResult {
  listId: string;
  listName: string;
  matchedKey: string | null;
  isUnrouted: boolean;
  /** True nếu hit cache (skip Graph API + DB lookup) */
  cacheHit: boolean;
}

/**
 * Parse #KEY cuối cùng từ campaign name, normalize uppercase. Null = no match.
 *
 * Examples:
 *   "Sunshine Q7 #A-001" → "A-001"
 *   "Sunshine #a-001" → "A-001" (case-insensitive)
 *   "Test #X-001 #B-002 final" → "B-002" (last)
 *   "No key here" → null
 */
export function parseKeyFromCampaignName(name: string): string | null {
  if (typeof name !== 'string' || !name) return null;
  const m = name.match(KEY_REGEX);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Resolve campaign → CustomerListId. Cache trước, DB lookup khi miss.
 *
 * @param orgId — multi-tenant scope
 * @param campaignId — Meta-side stable ID (cache key)
 * @param campaignName — current name từ Graph API (cho parse + invalidation check)
 */
export async function resolveListFromCampaign(
  orgId: string,
  campaignId: string,
  campaignName: string,
): Promise<RoutingResult> {
  // Tier 1: cache hit & name không đổi (key chưa edit trong tên campaign)
  const cached = await getCachedCampaign(campaignId);
  if (cached && cached.campaignName === campaignName) {
    if (cached.matchedListId) {
      return {
        listId: cached.matchedListId,
        listName: '(cached)',
        matchedKey: cached.matchedKey,
        isUnrouted: false,
        cacheHit: true,
      };
    }
    // Cached as Unrouted — vẫn resolve to Unrouted list every time
    const unrouted = await ensureUnroutedList(orgId);
    return {
      listId: unrouted.id,
      listName: unrouted.name,
      matchedKey: null,
      isUnrouted: true,
      cacheHit: true,
    };
  }

  // Tier 2: cache miss / stale → parse + DB lookup
  const key = parseKeyFromCampaignName(campaignName);
  if (!key) {
    // Campaign name không có #KEY → Unrouted
    const unrouted = await ensureUnroutedList(orgId);
    await setCachedCampaign({
      campaignId,
      orgId,
      campaignName,
      matchedKey: null,
      matchedListId: null, // null cache = Unrouted indicator
    });
    return {
      listId: unrouted.id,
      listName: unrouted.name,
      matchedKey: null,
      isUnrouted: true,
      cacheHit: false,
    };
  }

  // Lookup list by integrationKey
  const list = await prisma.customerList.findFirst({
    where: { orgId, integrationKey: key, archivedAt: null },
    select: { id: true, name: true },
  });

  if (!list) {
    // Key không tồn tại trong CRM → Unrouted
    const unrouted = await ensureUnroutedList(orgId);
    await setCachedCampaign({
      campaignId,
      orgId,
      campaignName,
      matchedKey: key,
      matchedListId: null,
    });
    return {
      listId: unrouted.id,
      listName: unrouted.name,
      matchedKey: key,
      isUnrouted: true,
      cacheHit: false,
    };
  }

  await setCachedCampaign({
    campaignId,
    orgId,
    campaignName,
    matchedKey: key,
    matchedListId: list.id,
  });
  return {
    listId: list.id,
    listName: list.name,
    matchedKey: key,
    isUnrouted: false,
    cacheHit: false,
  };
}

/**
 * Ensure list "🚨 Unrouted FB" tồn tại per org. Lazy create lần đầu.
 * Reuse existing CustomerList table; sourceType='api' để phân biệt với paste/CSV.
 */
async function ensureUnroutedList(orgId: string): Promise<{ id: string; name: string }> {
  const UNROUTED_KEY = '__UNROUTED__';
  let list = await prisma.customerList.findFirst({
    where: { orgId, integrationKey: UNROUTED_KEY },
    select: { id: true, name: true, createdById: true },
  });
  if (list) return { id: list.id, name: list.name };

  // Find any user from org để gán createdById (system-created)
  const owner = await prisma.user.findFirst({
    where: { orgId, role: 'owner' },
    select: { id: true },
  });
  if (!owner) {
    logger.error(`[lead-routing] No owner found for org ${orgId} — cannot auto-create Unrouted list`);
    throw new Error('Cannot create Unrouted list: org has no owner user');
  }

  list = await prisma.customerList.create({
    data: {
      orgId,
      name: '🚨 Unrouted Lead Ads',
      iconEmoji: '🚨',
      sourceType: 'api',
      integrationKey: UNROUTED_KEY,
      createdById: owner.id,
      status: 'processing',
    },
    select: { id: true, name: true, createdById: true },
  });
  logger.info(`[lead-routing] Auto-created Unrouted list for org ${orgId}: ${list.id}`);
  return { id: list.id, name: list.name };
}
