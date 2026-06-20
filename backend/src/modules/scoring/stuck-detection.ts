// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/stuck-detection.ts — Phát hiện KH đình trệ theo per-stage thresholds.
 *
 * Cron daily 6am scan tất cả Friend:
 *   - Tính daysInStage = (now - stageEnteredAt) / 1d  (fallback: createdAt nếu null)
 *   - Lookup StuckThreshold cho current stage
 *   - Nếu daysInStage > threshold → set Friend.stuckSince = now (nếu chưa set)
 *   - Nếu daysInStage < threshold AND stuckSince đã set → clear stuckSince
 *     (KH đã tương tác trở lại / promoted stage)
 *
 * Stuck Detection Dashboard query: WHERE stuckSince IS NOT NULL, group by stage.
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';
import { updateContactAggregateBatch } from './aggregate-contact.js';

const BATCH_SIZE = 500;

export interface StuckScanResult {
  orgId: string;
  scanned: number;
  newlyStuck: number;
  unstuck: number;
  contactsAggregated: number;
  durationMs: number;
}

/**
 * Scan tất cả Friend trong 1 org, set/clear stuckSince theo per-stage threshold.
 */
export async function runStuckDetectionForOrg(orgId: string): Promise<StuckScanResult> {
  const startedAt = Date.now();

  // Load all stuck thresholds (per-stage map)
  const thresholds = await prisma.stuckThreshold.findMany({
    where: { orgId, enabled: true },
  });
  const thresholdMap = new Map(thresholds.map((t) => [t.stage, t]));

  // Load all statuses (id → name)
  const statuses = await prisma.status.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const statusMap = new Map(statuses.map((s) => [s.id, s.name]));

  let scanned = 0;
  let newlyStuck = 0;
  let unstuck = 0;
  const affectedContactIds = new Set<string>();

  // Cursor-based pagination
  let cursor: string | undefined;
  while (true) {
    const friends = await prisma.friend.findMany({
      where: { orgId },
      select: {
        id: true,
        contactId: true,
        statusId: true,
        stuckSince: true,
        stageEnteredAt: true,
        createdAt: true,
        lastInboundAt: true,
      },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (friends.length === 0) break;
    cursor = friends[friends.length - 1].id;

    for (const f of friends) {
      scanned++;
      const result = await evaluateFriendStuck(orgId, f, thresholdMap, statusMap);
      if (result === 'newly_stuck') {
        newlyStuck++;
        if (f.contactId) affectedContactIds.add(f.contactId);
      } else if (result === 'unstuck') {
        unstuck++;
        if (f.contactId) affectedContactIds.add(f.contactId);
      }
    }

    if (friends.length < BATCH_SIZE) break;
  }

  const aggResult = await updateContactAggregateBatch(Array.from(affectedContactIds), 20);
  const durationMs = Date.now() - startedAt;

  logger.info(
    { orgId, scanned, newlyStuck, unstuck, contactsAggregated: aggResult.updated, durationMs },
    'Stuck detection job completed'
  );

  return {
    orgId,
    scanned,
    newlyStuck,
    unstuck,
    contactsAggregated: aggResult.updated,
    durationMs,
  };
}

/**
 * Scan all orgs (cron entry point).
 */
export async function runStuckDetectionAllOrgs(): Promise<StuckScanResult[]> {
  const orgs = await prisma.organization.findMany({
    where: { scoringConfig: { stuckDetectionEnabled: true } },
    select: { id: true },
  });
  const results: StuckScanResult[] = [];
  for (const org of orgs) {
    try {
      results.push(await runStuckDetectionForOrg(org.id));
    } catch (err) {
      logger.error({ orgId: org.id, err }, 'stuck detection failed');
    }
  }
  return results;
}

// ─── Internal ────────────────────────────────────────────────────────────

async function evaluateFriendStuck(
  orgId: string,
  friend: {
    id: string;
    statusId: string | null;
    stuckSince: Date | null;
    stageEnteredAt: Date | null;
    createdAt: Date;
    lastInboundAt: Date | null;
  },
  thresholdMap: Map<string, { thresholdDays: number; alertLabel: string; stage: string }>,
  statusMap: Map<string, string>
): Promise<'newly_stuck' | 'unstuck' | 'no_change'> {
  if (!friend.statusId) return 'no_change';

  const stageName = statusMap.get(friend.statusId);
  if (!stageName) return 'no_change';

  const threshold = thresholdMap.get(stageName);
  if (!threshold) return 'no_change';

  const referenceTime = friend.stageEnteredAt ?? friend.createdAt;
  const daysInStage = Math.floor((Date.now() - referenceTime.getTime()) / (24 * 3600 * 1000));

  const shouldBeStuck = daysInStage >= threshold.thresholdDays;
  const isCurrentlyStuck = friend.stuckSince !== null;

  if (shouldBeStuck && !isCurrentlyStuck) {
    try {
      await prisma.friend.update({
        where: { id: friend.id },
        data: { stuckSince: new Date() },
      });
      logActivity({
        orgId,
        systemSource: 'stuck_detection',
        action: 'friend_stuck_flagged',
        entityType: 'friend',
        entityId: friend.id,
        category: 'system',
        details: { stage: stageName, daysInStage, threshold: threshold.thresholdDays },
      });
      return 'newly_stuck';
    } catch (err) {
      logger.error({ friendId: friend.id, err }, 'Failed to flag stuck');
      return 'no_change';
    }
  }

  if (!shouldBeStuck && isCurrentlyStuck) {
    try {
      await prisma.friend.update({
        where: { id: friend.id },
        data: { stuckSince: null },
      });
      logActivity({
        orgId,
        systemSource: 'stuck_detection',
        action: 'friend_unstuck',
        entityType: 'friend',
        entityId: friend.id,
        category: 'system',
        details: { stage: stageName, daysInStage },
      });
      return 'unstuck';
    } catch (err) {
      logger.error({ friendId: friend.id, err }, 'Failed to unstuck');
      return 'no_change';
    }
  }

  return 'no_change';
}
