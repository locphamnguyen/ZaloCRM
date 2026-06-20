// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * meta-campaign-cache.service.ts — TTL 5 phút cache cho campaign_id → list_id.
 *
 * Eng review Issue 5: anh đổi #KEY trong tên campaign → cache stale tối đa 5 phút,
 * sau đó re-fetch Graph API → re-parse → update cache → lead mới đi list mới.
 *
 * Cache đặt trong DB (MetaCampaignCache table) thay vì in-memory:
 * - Survive container restart
 * - Multi-instance deploy Phase 2+ vẫn share
 * - Audit: query để xem campaign nào cached khi nào
 */
import { prisma } from '../../../shared/database/prisma-client.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CachedCampaign {
  campaignId: string;
  orgId: string;
  campaignName: string;
  matchedKey: string | null;
  matchedListId: string | null;
}

/**
 * Read cache. Null nếu miss hoặc expired (TTL 5p).
 * Caller phải check `campaignName` field — nếu khác current → cache stale, re-fetch.
 */
export async function getCachedCampaign(campaignId: string): Promise<CachedCampaign | null> {
  const row = await prisma.metaCampaignCache.findUnique({
    where: { campaignId },
    select: { campaignId: true, orgId: true, campaignName: true, matchedKey: true, matchedListId: true, cachedAt: true },
  });
  if (!row) return null;
  const age = Date.now() - row.cachedAt.getTime();
  if (age > CACHE_TTL_MS) return null;
  return {
    campaignId: row.campaignId,
    orgId: row.orgId,
    campaignName: row.campaignName,
    matchedKey: row.matchedKey,
    matchedListId: row.matchedListId,
  };
}

/** Upsert cache. Đồng thời reset cachedAt timestamp. */
export async function setCachedCampaign(input: CachedCampaign): Promise<void> {
  await prisma.metaCampaignCache.upsert({
    where: { campaignId: input.campaignId },
    create: {
      campaignId: input.campaignId,
      orgId: input.orgId,
      campaignName: input.campaignName,
      matchedKey: input.matchedKey,
      matchedListId: input.matchedListId,
      cachedAt: new Date(),
    },
    update: {
      campaignName: input.campaignName,
      matchedKey: input.matchedKey,
      matchedListId: input.matchedListId,
      cachedAt: new Date(),
    },
  });
}

/** Invalidate cache khi admin edit integrationKey trên list (force re-fetch lần sau). */
export async function invalidateCacheForList(listId: string): Promise<void> {
  await prisma.metaCampaignCache.updateMany({
    where: { matchedListId: listId },
    data: { cachedAt: new Date(0) }, // epoch → next read sẽ thấy expired
  });
}
