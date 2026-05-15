/**
 * scoring/auto-tag.ts — Auto-tag metadata layer cho Friend.
 *
 * 7 tags update real-time/daily theo state:
 *   active     — inbound 24h qua
 *   cooling    — silent 7-14d
 *   cold       — silent 15-30d
 *   frozen     — silent 60d+
 *   rewarmed   — đã cold → có inbound trong 48h
 *   stuck      — flagged stuckSince ở stage 1/2/3
 *   ready      — score ≥ 80
 *   atrisk     — score giảm > 20 trong 7 ngày
 *
 * Tag là METADATA, không thay 8 pipeline stages. 1 friend có nhiều tag đồng thời.
 *
 * Compute:
 *   - Hot path: tag-on-write trong score-engine + stuck-detection (cheap)
 *   - Cold path: cron daily 6am recompute all (catch edge cases)
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { updateContactAggregateBatch } from './aggregate-contact.js';
import type { AutoTagKey } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute tags for a single friend từ state hiện tại.
 *
 * @param friend - Friend snapshot
 * @returns set of auto tags (deduped)
 */
export function computeAutoTagsForFriend(friend: {
  leadScore: number;
  lastInboundAt: Date | null;
  stuckSince: Date | null;
  scoreBreakdown: any;
  // For atrisk detection: previous score 7d ago — passed in by caller
  scoreBreakdown7dAgo?: number | null;
}): AutoTagKey[] {
  const tags = new Set<AutoTagKey>();
  const now = Date.now();

  // Silent-based tags
  if (friend.lastInboundAt) {
    const daysSilent = Math.floor((now - friend.lastInboundAt.getTime()) / DAY_MS);
    if (daysSilent < 1) {
      tags.add('active');
    } else if (daysSilent >= 7 && daysSilent < 15) {
      tags.add('cooling');
    } else if (daysSilent >= 15 && daysSilent < 30) {
      tags.add('cold');
    } else if (daysSilent >= 60) {
      tags.add('frozen');
    }
    // 30-60: ngầm hiểu cold continues
    if (daysSilent >= 30 && daysSilent < 60) {
      tags.add('cold');
    }
  }

  // Stuck
  if (friend.stuckSince) {
    tags.add('stuck');
  }

  // Ready
  if (friend.leadScore >= 80) {
    tags.add('ready');
  }

  // At-risk: score dropped > 20 in 7d
  if (friend.scoreBreakdown7dAgo != null) {
    const drop = friend.scoreBreakdown7dAgo - friend.leadScore;
    if (drop > 20) {
      tags.add('atrisk');
    }
  }

  // Re-warmed: detection requires history — handled separately via cron + history check

  return Array.from(tags);
}

/**
 * Update Friend.autoTags + log if changed.
 */
export async function updateFriendAutoTags(friendId: string): Promise<boolean> {
  try {
    const friend = await prisma.friend.findUnique({
      where: { id: friendId },
      select: {
        id: true,
        orgId: true,
        contactId: true,
        leadScore: true,
        lastInboundAt: true,
        stuckSince: true,
        scoreBreakdown: true,
        autoTags: true,
      },
    });
    if (!friend) return false;

    // Check if 7d ago there was a notably higher score (atrisk detection)
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
    const historicalScoreLog = await prisma.activityLog.findFirst({
      where: {
        entityType: 'friend',
        entityId: friendId,
        action: 'score_change',
        createdAt: { lte: sevenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      select: { details: true },
    });
    const oldScore =
      historicalScoreLog?.details && typeof historicalScoreLog.details === 'object'
        ? (historicalScoreLog.details as any).newScore ?? null
        : null;

    const newTags = computeAutoTagsForFriend({
      leadScore: friend.leadScore,
      lastInboundAt: friend.lastInboundAt,
      stuckSince: friend.stuckSince,
      scoreBreakdown: friend.scoreBreakdown,
      scoreBreakdown7dAgo: oldScore,
    });

    // Detect re-warmed: was cold yesterday, has inbound in 48h
    const wasCold =
      Array.isArray(friend.autoTags) &&
      (friend.autoTags.includes('cold') ||
        friend.autoTags.includes('frozen') ||
        friend.autoTags.includes('cooling'));
    const isActiveNow = newTags.includes('active');
    if (wasCold && isActiveNow) {
      newTags.push('rewarmed');
      // Remove cold/cooling/frozen since rewarmed is the more current state
      const filtered = newTags.filter((t) => t !== 'cold' && t !== 'frozen' && t !== 'cooling');
      if (filtered.length !== newTags.length) {
        filtered.push('rewarmed');
      }
    }

    // Compare with existing
    const existingTags = (friend.autoTags as AutoTagKey[]) ?? [];
    const existingSet = new Set(existingTags);
    const newSet = new Set(newTags);
    const same =
      existingSet.size === newSet.size && [...existingSet].every((t) => newSet.has(t));
    if (same) return false;

    await prisma.friend.update({
      where: { id: friendId },
      data: { autoTags: newTags },
    });

    return true;
  } catch (err) {
    logger.error({ friendId, err }, 'updateFriendAutoTags failed');
    return false;
  }
}

/**
 * Cron daily 6am: recompute auto-tags cho tất cả Friend trong 1 org.
 * Idempotent, batch 500.
 */
export async function runAutoTagsForOrg(orgId: string): Promise<{
  orgId: string;
  scanned: number;
  changed: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  let scanned = 0;
  let changed = 0;
  const affectedContactIds = new Set<string>();

  let cursor: string | undefined;
  while (true) {
    const friends = await prisma.friend.findMany({
      where: { orgId },
      select: { id: true, contactId: true },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (friends.length === 0) break;
    cursor = friends[friends.length - 1].id;

    for (const f of friends) {
      scanned++;
      const changed_ = await updateFriendAutoTags(f.id);
      if (changed_) {
        changed++;
        if (f.contactId) affectedContactIds.add(f.contactId);
      }
    }

    if (friends.length < 500) break;
  }

  await updateContactAggregateBatch(Array.from(affectedContactIds), 20);

  const durationMs = Date.now() - startedAt;
  logger.info(
    { orgId, scanned, changed, durationMs },
    'Auto-tag cron completed'
  );

  return { orgId, scanned, changed, durationMs };
}

export async function runAutoTagsAllOrgs() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const results = [];
  for (const org of orgs) {
    try {
      results.push(await runAutoTagsForOrg(org.id));
    } catch (err) {
      logger.error({ orgId: org.id, err }, 'auto-tag failed');
    }
  }
  return results;
}
