// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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
import { logActivity } from '../activity/activity-logger.js';
import type { AutoTagKey } from './types.js';
import { AUTO_TAG_LABELS, AUTO_TAG_ICONS } from './types.js';

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
  // For has-appointment detection: count of future scheduled appointments
  futureAppointmentCount?: number;
}): AutoTagKey[] {
  const tags = new Set<AutoTagKey>();
  const now = Date.now();

  // Silent-based tags (recency group — exactly 1 sẽ qua bộ lọc mutual-exclusion)
  if (friend.lastInboundAt) {
    const daysSilent = Math.floor((now - friend.lastInboundAt.getTime()) / DAY_MS);
    if (daysSilent < 1) {
      tags.add('active');
    } else if (daysSilent >= 7 && daysSilent < 15) {
      tags.add('cooling');
    } else if (daysSilent >= 15 && daysSilent < 60) {
      // 15-60 ngày → cold (unified — bỏ split 15-30/30-60 vì cùng action follow-up)
      tags.add('cold');
    } else if (daysSilent >= 60) {
      tags.add('frozen');
    }
  }

  // Stuck — pipeline blocker
  if (friend.stuckSince) {
    tags.add('stuck');
  }

  // Ready — score ≥ 80
  if (friend.leadScore >= 80) {
    tags.add('ready');
  }

  // At-risk — score dropped > 20 in 7d
  if (friend.scoreBreakdown7dAgo != null) {
    const drop = friend.scoreBreakdown7dAgo - friend.leadScore;
    if (drop > 20) {
      tags.add('atrisk');
    }
  }

  // Has-appointment — Friend có Appointment scheduled tương lai
  if ((friend.futureAppointmentCount ?? 0) > 0) {
    tags.add('has-appointment');
  }

  return applyMutualExclusion(Array.from(tags));
}

/**
 * Áp quy tắc loại trừ — 1 KH KHÔNG được vừa có tag mâu thuẫn logic.
 *
 * Logic groups:
 *   - Recency (active|cooling|cold|frozen|rewarmed) — exactly 1
 *   - Pipeline (stuck) — excludes active (KH đang chat → không đình trệ)
 *   - Outcome (ready vs atrisk) — atrisk win nếu cả 2 (cảnh báo > opportunity)
 *   - active overrides atrisk (KH đang chat → không có nguy cơ)
 *   - has-appointment — orthogonal, luôn giữ
 */
export function applyMutualExclusion(input: AutoTagKey[]): AutoTagKey[] {
  const out = new Set(input);
  const has = (t: AutoTagKey) => out.has(t);

  // Rule 1: rewarmed = active + (đã cold/cooling/frozen) — overrides cả 2
  if (has('rewarmed')) {
    out.delete('active');
    out.delete('cooling');
    out.delete('cold');
    out.delete('frozen');
  }

  // Rule 2: active overrides stuck (đang tương tác = không đình trệ)
  if (has('active') && has('stuck')) out.delete('stuck');

  // Rule 3: active overrides atrisk (đang tương tác = engagement đang lên, ko phải xuống)
  if (has('active') && has('atrisk')) out.delete('atrisk');

  // Rule 4: atrisk overrides ready (cảnh báo score giảm > status score cao)
  if (has('atrisk') && has('ready')) out.delete('ready');

  return [...out];
}

/**
 * Update Friend.autoTags + log if changed.
 * Ghi ActivityLog với tag diff (added/removed) khi thay đổi.
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

    // Has-appointment — đếm Appointment scheduled tương lai của contact này
    let futureAppointmentCount = 0;
    if (friend.contactId) {
      futureAppointmentCount = await prisma.appointment.count({
        where: {
          contactId: friend.contactId,
          status: 'scheduled',
          appointmentDate: { gte: new Date() },
        },
      });
    }

    let newTags = computeAutoTagsForFriend({
      leadScore: friend.leadScore,
      lastInboundAt: friend.lastInboundAt,
      stuckSince: friend.stuckSince,
      scoreBreakdown: friend.scoreBreakdown,
      scoreBreakdown7dAgo: oldScore,
      futureAppointmentCount,
    });

    // Detect re-warmed — was cold/cooling/frozen → has inbound trong 48h.
    // Inject `rewarmed`, qua mutual-exclusion sẽ tự loại active+cold combo.
    const existingTags = (friend.autoTags as AutoTagKey[]) ?? [];
    const wasCold = existingTags.includes('cold')
      || existingTags.includes('cooling')
      || existingTags.includes('frozen');
    if (wasCold && newTags.includes('active')) {
      newTags = applyMutualExclusion([...newTags, 'rewarmed']);
    }

    // Compare with existing — early exit nếu không đổi (tránh ghi DB + activity log thừa)
    const existingSet = new Set(existingTags);
    const newSet = new Set(newTags);
    const same =
      existingSet.size === newSet.size && [...existingSet].every((t) => newSet.has(t));
    if (same) return false;

    // Diff để log: tag nào vừa add, tag nào vừa remove
    const added = newTags.filter((t) => !existingSet.has(t));
    const removed = [...existingSet].filter((t) => !newSet.has(t));

    // M57 Wave 3 /plan-eng-review: route qua tag-service để dual-write junction.
    // Diff added/removed → call addFriendTag/removeFriendTag (source=auto_detect).
    //
    // ⚠️ Việt hóa 2026-06-06: slug PHẢI giữ = key tiếng Anh (active/cold/...) để không
    // vỡ junction cũ. Nhưng NAME hiển thị = tiếng Việt (AUTO_TAG_LABELS) + icon. Nếu dùng
    // addFriendTag({tagName:'Đã nguội', autoCreate}) thì slugifyTag('Đã nguội')='da-nguoi'
    // → tạo tag MỚI lệch slug. → Phải resolve/seed tag def theo slug=key + name Việt, rồi
    // add bằng tagId (KHÔNG autoCreate). Giống cách engagement-tag-service làm.
    const { addFriendTag, removeFriendTag } = await import('../tags/tag-service.js');

    // Helper: resolve tag def theo slug=key (auto_detect), tạo với name Việt nếu chưa có.
    const resolveDetectTagId = async (key: AutoTagKey): Promise<string | null> => {
      const existing = await prisma.tag.findFirst({
        where: { orgId: friend.orgId, scope: 'friend', source: 'auto_detect', slug: key, zaloAccountId: null },
        select: { id: true },
      });
      if (existing) return existing.id;
      const viName = `${AUTO_TAG_ICONS[key]} ${AUTO_TAG_LABELS[key]}`.trim();
      const created = await prisma.tag
        .create({
          data: { orgId: friend.orgId, name: viName, slug: key, color: '#F59E0B', scope: 'friend', source: 'auto_detect', priority: 3 },
          select: { id: true },
        })
        .catch(async () => {
          const again = await prisma.tag.findFirst({
            where: { orgId: friend.orgId, scope: 'friend', source: 'auto_detect', slug: key, zaloAccountId: null },
            select: { id: true },
          });
          return again;
        });
      return created?.id ?? null;
    };

    for (const key of added) {
      try {
        const tagId = await resolveDetectTagId(key);
        if (tagId) {
          await addFriendTag({ friendId, tagId, source: 'auto_detect', addedBy: null });
          // CareSession 2026-06-07: tag tự động cũng đóng phiên nếu ∈ closeConditions.
          if (friend.contactId) {
            const { onTagAdded } = await import('../../shared/ee-registry/automation.js');
            await onTagAdded({ orgId: friend.orgId, contactId: friend.contactId, tagKind: 'friendTag', tagId });
          }
        }
      } catch (err) {
        logger.warn?.(`[auto-tag] addFriendTag fail ${key}: ${(err as Error).message}`);
      }
    }
    for (const key of removed) {
      try {
        const tag = await prisma.tag.findFirst({
          where: { orgId: friend.orgId, scope: 'friend', source: 'auto_detect', slug: key, zaloAccountId: null },
          select: { id: true },
        });
        if (tag) {
          await removeFriendTag({ friendId, tagId: tag.id, removedBy: null });
        }
      } catch (err) {
        logger.warn?.(`[auto-tag] removeFriendTag fail ${key}: ${(err as Error).message}`);
      }
    }

    // ActivityLog — log với entityType='contact' (timeline UI lọc theo contactId),
    // actorType='bot' (qua botName), category='automation' (auto từ map).
    // Diff added/removed để FE render chip thay đổi rõ.
    if ((added.length || removed.length) && friend.contactId) {
      logActivity({
        orgId: friend.orgId,
        botName: 'AutoTag Bot',
        action: 'auto_tag_change',
        entityType: 'contact',
        entityId: friend.contactId,
        details: {
          friendId,
          added,
          removed,
          context: {
            leadScore: friend.leadScore,
            daysSilent: friend.lastInboundAt
              ? Math.floor((Date.now() - friend.lastInboundAt.getTime()) / DAY_MS)
              : null,
            stuckSince: friend.stuckSince,
            futureAppointmentCount,
          },
        },
      });
    }

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
