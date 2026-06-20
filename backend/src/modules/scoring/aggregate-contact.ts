// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/aggregate-contact.ts — Aggregate Friend → Contact scoring.
 *
 * Trigger: gọi sau mỗi Friend.leadScore update (qua score-engine.ts PR2).
 *
 * Rules (chốt 2026-05-16):
 *   - Contact.leadScore           = MAX(Friend.leadScore)
 *   - Contact.statusId            = Friend.statusId có Status.order cao nhất
 *   - Contact.ownerFriendId       = Friend score cao nhất + lastInboundAt 14d
 *   - Contact.aggregateBreakdown  = breakdown của ownerFriend
 *   - Contact.autoTags            = UNION(Friend.autoTags) deduped
 *   - Contact.stuckSinceAggregate = MIN(Friend.stuckSince) khi ALL Friend stuck
 *   - Contact.lastActivity        = MAX(Friend.lastInboundAt|lastOutboundAt|lastInteractionAt)
 *
 * Performance: KH có ≤ 5 Friend (95% case) → < 5ms. KH có nhiều Friend
 * (rare) vẫn < 50ms vì query 1 lần lấy all Friend.
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import type { ContactAggregateResult, AutoTagKey, ScoreBreakdown } from './types.js';

const OWNER_ACTIVE_DAYS = 14; // Friend với lastInboundAt < 14d được consider làm owner

/**
 * Compute aggregate cho 1 contact từ tất cả Friend rows của KH đó.
 *
 * @param contactId - Contact UUID
 * @returns ContactAggregateResult (chưa write DB)
 */
export async function computeContactAggregate(
  contactId: string
): Promise<ContactAggregateResult | null> {
  // Query all Friend + Status để tránh N+1
  const friends = await prisma.friend.findMany({
    where: { contactId },
    select: {
      id: true,
      leadScore: true,
      statusId: true,
      scoreBreakdown: true,
      autoTags: true,
      stuckSince: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      lastInteractionAt: true,
      statusRef: {
        select: { id: true, order: true, name: true },
      },
    },
  });

  if (friends.length === 0) {
    // KH chưa có Friend → không aggregate, giữ score = 0
    return {
      leadScore: 0,
      statusId: null,
      ownerFriendId: null,
      aggregateBreakdown: {},
      autoTags: [],
      stuckSinceAggregate: null,
      lastActivity: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    };
  }

  // ── 1. MAX leadScore + breakdown của Friend đỉnh ────────────────────────
  let maxScore = -1;
  let maxScoreFriend: (typeof friends)[number] | null = null;
  for (const f of friends) {
    if (f.leadScore > maxScore) {
      maxScore = f.leadScore;
      maxScoreFriend = f;
    }
  }
  const leadScore = Math.max(0, maxScore);
  const aggregateBreakdown = (maxScoreFriend?.scoreBreakdown as ScoreBreakdown | null) ?? {};

  // ── 2. Status có order cao nhất ─────────────────────────────────────────
  let maxOrder = -1;
  let topStatusId: string | null = null;
  for (const f of friends) {
    if (f.statusRef && f.statusRef.order > maxOrder) {
      maxOrder = f.statusRef.order;
      topStatusId = f.statusRef.id;
    }
  }

  // ── 3. Owner = score cao + active 14d ───────────────────────────────────
  const now = new Date();
  const cutoff = new Date(now.getTime() - OWNER_ACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const activeFriends = friends.filter((f) => f.lastInboundAt && f.lastInboundAt >= cutoff);

  let ownerFriendId: string | null = null;
  if (activeFriends.length > 0) {
    // Sort: leadScore DESC, sau đó lastInboundAt DESC
    activeFriends.sort((a, b) => {
      if (b.leadScore !== a.leadScore) return b.leadScore - a.leadScore;
      const aTime = a.lastInboundAt?.getTime() ?? 0;
      const bTime = b.lastInboundAt?.getTime() ?? 0;
      return bTime - aTime;
    });
    ownerFriendId = activeFriends[0].id;
  } else if (maxScoreFriend) {
    // Không có active 14d → fall back maxScore friend
    ownerFriendId = maxScoreFriend.id;
  }

  // ── 4. autoTags UNION deduped ───────────────────────────────────────────
  const tagSet = new Set<AutoTagKey>();
  for (const f of friends) {
    const tags = (f.autoTags as AutoTagKey[]) ?? [];
    for (const tag of tags) tagSet.add(tag);
  }
  const autoTags = Array.from(tagSet);

  // ── 5. stuckSinceAggregate = MIN khi ALL Friend stuck ───────────────────
  const allStuck = friends.every((f) => f.stuckSince !== null);
  let stuckSinceAggregate: Date | null = null;
  if (allStuck) {
    const stuckDates = friends
      .map((f) => f.stuckSince)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    stuckSinceAggregate = stuckDates[0] ?? null;
  }

  // ── 6. lastActivity = MAX(lastInboundAt | lastOutboundAt | lastInteractionAt) ──
  // Phase Lead Pool v2.A 2026-05-29: tách lastInboundAt + lastOutboundAt riêng.
  // forgotten pool query đổi sang dùng lastInboundAt để chỉ tính lần KH reply
  // (sale spam outbound KHÔNG còn giữ lead vĩnh viễn).
  let lastActivity: Date | null = null;
  let lastInboundAt: Date | null = null;
  let lastOutboundAt: Date | null = null;
  for (const f of friends) {
    if (f.lastInboundAt && (!lastInboundAt || f.lastInboundAt > lastInboundAt)) lastInboundAt = f.lastInboundAt;
    if (f.lastOutboundAt && (!lastOutboundAt || f.lastOutboundAt > lastOutboundAt)) lastOutboundAt = f.lastOutboundAt;
    for (const ts of [f.lastInboundAt, f.lastOutboundAt, f.lastInteractionAt]) {
      if (ts && (!lastActivity || ts > lastActivity)) lastActivity = ts;
    }
  }

  return {
    leadScore,
    statusId: topStatusId,
    ownerFriendId,
    aggregateBreakdown,
    autoTags,
    stuckSinceAggregate,
    lastActivity,
    lastInboundAt,
    lastOutboundAt,
  };
}

/**
 * Compute + persist aggregate vào Contact row.
 * Idempotent — gọi nhiều lần safe.
 *
 * @param contactId - Contact UUID
 * @returns updated Contact partial fields (chưa fetch full row)
 */
export async function updateContactAggregate(contactId: string): Promise<void> {
  const result = await computeContactAggregate(contactId);
  if (!result) return;

  try {
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        leadScore: result.leadScore,
        // FIFO 2026-06-16 — KHÔNG ghi đè Contact.statusId về null khi không Friend nào có status
        // (vd lead Pool KH-không-Zalo: status được set thẳng vào Contact, chưa có Friend mang status).
        // Chỉ cập nhật khi aggregate ra status thật (≥1 Friend có status). Giữ status sale đã set.
        ...(result.statusId !== null ? { statusId: result.statusId } : {}),
        ownerFriendId: result.ownerFriendId,
        aggregateBreakdown: result.aggregateBreakdown as any,
        autoTags: result.autoTags,
        stuckSinceAggregate: result.stuckSinceAggregate,
        lastActivity: result.lastActivity,
        lastInboundAt: result.lastInboundAt,
        lastOutboundAt: result.lastOutboundAt,
        aggregateScoreUpdatedAt: new Date(),
      },
    });

    // Phase 8.C — Recompute Priority Score sau khi leadScore aggregate đổi.
    // Fire-and-forget, không block aggregate path.
    void (async () => {
      try {
        const { recomputeContactPriority } = await import('../engagement/priority-service.js');
        await recomputeContactPriority(contactId);
      } catch {
        /* silent — priority is best-effort */
      }
    })();
  } catch (err) {
    logger.error({ contactId, err }, 'Failed to update contact aggregate');
  }
}

/**
 * Fire-and-forget version cho callers không cần await.
 * Dùng trong score-engine sau mỗi Friend.score update.
 */
export function updateContactAggregateAsync(contactId: string): void {
  void updateContactAggregate(contactId).catch((err) => {
    logger.error({ contactId, err }, 'Async contact aggregate failed');
  });
}

/**
 * Batch update — dùng cho cron job daily decay hoặc weight config change.
 * Process tuần tự để tránh DB pool exhaustion.
 *
 * @param contactIds - List Contact UUIDs
 * @param batchSize - max parallel updates per batch (default 10)
 */
export async function updateContactAggregateBatch(
  contactIds: string[],
  batchSize = 10
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < contactIds.length; i += batchSize) {
    const batch = contactIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map((id) => updateContactAggregate(id)));
    for (const r of results) {
      if (r.status === 'fulfilled') updated++;
      else failed++;
    }
  }

  return { updated, failed };
}
