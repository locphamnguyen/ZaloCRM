// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/decay-cron.ts — Daily decay job (silent customer penalty).
 *
 * Run hourly hoặc daily 6am cron. Scan tất cả Friend với lastInboundAt < cutoff,
 * apply decay theo ScoringConfig.decayDay* + StuckThreshold.extraDecayPerDay nếu stuck.
 *
 * Performance: process per-org batch 500 Friend/batch, parallel batches OK vì
 * decay là idempotent (recompute từ current state).
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';
import { getScoringConfig } from './config-cache.js';
import { updateContactAggregateBatch } from './aggregate-contact.js';
import { computeFinalScore } from './score-engine.js';
import type { ScoreBreakdown, ScoringConfigSnapshot } from './types.js';

const BATCH_SIZE = 500;

export interface DecayJobResult {
  orgId: string;
  scanned: number;
  decayed: number;
  contactsAggregated: number;
  durationMs: number;
}

/**
 * Run decay for 1 org. Idempotent — safe để chạy mỗi giờ.
 *
 * Logic per friend:
 *   - Tính daysSilent = (now - lastInboundAt) / 1d
 *   - Lookup decayPerDay từ config (theo bucket 3-7 / 7-14 / 14-30 / 30-60)
 *   - Nếu stuck (stuckSince đã set) → cộng StuckThreshold.extraDecayPerDay
 *   - Cộng cumulative decay vào sub-score engagement: engagement -= decayAmount
 *   - Recompute finalScore qua weights
 *   - Update Friend.scoreBreakdown + leadScore + scoreUpdatedAt
 *   - Log activity nếu delta != 0
 */
export async function runDecayForOrg(orgId: string): Promise<DecayJobResult> {
  return withTenant(orgId, () => runDecayForOrgInner(orgId));
}

async function runDecayForOrgInner(orgId: string): Promise<DecayJobResult> {
  const startedAt = Date.now();
  const config = await getScoringConfig(orgId);

  // Stuck thresholds map (stage → extraDecay)
  const stuckThresholds = await prisma.stuckThreshold.findMany({
    where: { orgId, enabled: true },
  });
  const stuckMap = new Map(stuckThresholds.map((t) => [t.stage, t]));

  // Status map (id → name) để lookup theo stage
  const statuses = await prisma.status.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const statusMap = new Map(statuses.map((s) => [s.id, s.name]));

  let scanned = 0;
  let decayed = 0;
  const affectedContactIds = new Set<string>();

  // Cursor-based pagination
  let cursor: string | undefined;
  while (true) {
    const friends = await prisma.friend.findMany({
      where: {
        orgId,
        OR: [{ lastInboundAt: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } }, { lastInboundAt: null }],
      },
      select: {
        id: true,
        contactId: true,
        leadScore: true,
        scoreBreakdown: true,
        statusId: true,
        lastInboundAt: true,
        stuckSince: true,
      },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    if (friends.length === 0) break;
    cursor = friends[friends.length - 1].id;

    for (const f of friends) {
      scanned++;
      const decayApplied = await applyDecayToFriend(orgId, f, config, stuckMap, statusMap);
      if (decayApplied) {
        decayed++;
        if (f.contactId) affectedContactIds.add(f.contactId);
      }
    }

    if (friends.length < BATCH_SIZE) break;
  }

  // Batch update Contact aggregate cho affected contacts
  const aggResult = await updateContactAggregateBatch(Array.from(affectedContactIds), 20);

  const durationMs = Date.now() - startedAt;
  logger.info(
    { orgId, scanned, decayed, contactsAggregated: aggResult.updated, durationMs },
    'Decay job completed for org'
  );

  return {
    orgId,
    scanned,
    decayed,
    contactsAggregated: aggResult.updated,
    durationMs,
  };
}

/**
 * Run decay cho tất cả org. Gọi từ scheduler (cron / setInterval).
 */
export async function runDecayAllOrgs(): Promise<DecayJobResult[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const results: DecayJobResult[] = [];
  for (const org of orgs) {
    try {
      const r = await runDecayForOrg(org.id);
      results.push(r);
    } catch (err) {
      logger.error({ orgId: org.id, err }, 'Decay failed for org');
    }
  }
  return results;
}

// ─── Internal ────────────────────────────────────────────────────────────

async function applyDecayToFriend(
  orgId: string,
  friend: {
    id: string;
    contactId: string;
    leadScore: number;
    scoreBreakdown: any;
    statusId: string | null;
    lastInboundAt: Date | null;
    stuckSince: Date | null;
  },
  config: ScoringConfigSnapshot,
  stuckMap: Map<string, { extraDecayPerDay: number; thresholdDays: number }>,
  statusMap: Map<string, string>
): Promise<boolean> {
  const now = Date.now();
  const lastInbound = friend.lastInboundAt?.getTime() ?? null;
  if (!lastInbound) return false; // chưa từng inbound → không decay (KH mới chưa engage)

  const daysSilent = Math.floor((now - lastInbound) / (24 * 60 * 60 * 1000));
  if (daysSilent < 3) return false;

  // Bucket decay/ngày
  let decayPerDay = 0;
  if (daysSilent >= 30 && daysSilent < 60) decayPerDay = config.decay.day30to60;
  else if (daysSilent >= 14) decayPerDay = config.decay.day14to30;
  else if (daysSilent >= 7) decayPerDay = config.decay.day7to14;
  else if (daysSilent >= 3) decayPerDay = config.decay.day3to7;
  // > 60 ngày: drop to Frozen (handled in auto-tag, không decay tiếp)
  if (daysSilent >= 60) return false;

  // Stage stuck extra decay
  const stageName = friend.statusId ? statusMap.get(friend.statusId) : null;
  const stuckCfg = stageName ? stuckMap.get(stageName) : undefined;
  let extraDecay = 0;
  if (stuckCfg && friend.stuckSince && daysSilent >= stuckCfg.thresholdDays) {
    extraDecay = stuckCfg.extraDecayPerDay;
  }

  const totalDecay = decayPerDay - extraDecay; // both negative ngầm hiểu
  if (totalDecay >= 0) return false;

  // Parse breakdown, apply to engagement
  const currentBreakdown = parseBreakdown(friend.scoreBreakdown);
  const newEngagement = Math.max(0, currentBreakdown.engagement + totalDecay);

  if (newEngagement === currentBreakdown.engagement) return false;

  const newBreakdown = {
    ...currentBreakdown,
    engagement: newEngagement,
  };
  const finalScore = computeFinalScore(newBreakdown, config);
  const delta = finalScore - friend.leadScore;
  if (delta === 0) return false;

  try {
    await prisma.friend.update({
      where: { id: friend.id },
      data: {
        leadScore: finalScore,
        scoreBreakdown: {
          ...newBreakdown,
          finalScore,
          computedAt: new Date().toISOString(),
        } as any,
        scoreUpdatedAt: new Date(),
      },
    });

    if (Math.abs(delta) >= 1) {
      logActivity({
        orgId,
        systemSource: 'scoring_decay_cron',
        action: 'score_decay',
        entityType: 'friend',
        entityId: friend.id,
        category: 'score',
        details: {
          oldScore: friend.leadScore,
          newScore: finalScore,
          delta,
          daysSilent,
          decayPerDay,
          extraDecay,
          stage: stageName ?? null,
        },
      });
    }

    return true;
  } catch (err) {
    logger.error({ friendId: friend.id, err }, 'Decay update failed');
    return false;
  }
}

function parseBreakdown(raw: any): ScoreBreakdown {
  const defaults: ScoreBreakdown = {
    engagement: 0,
    intent: 0,
    fit: 0,
    velocity: 0,
    finalScore: 0,
    computedAt: new Date(0).toISOString(),
  };
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    engagement: typeof raw.engagement === 'number' ? raw.engagement : 0,
    intent: typeof raw.intent === 'number' ? raw.intent : 0,
    fit: typeof raw.fit === 'number' ? raw.fit : 0,
    velocity: typeof raw.velocity === 'number' ? raw.velocity : 0,
    finalScore: typeof raw.finalScore === 'number' ? raw.finalScore : 0,
    computedAt: typeof raw.computedAt === 'string' ? raw.computedAt : defaults.computedAt,
    signals: Array.isArray(raw.signals) ? raw.signals : [],
  };
}
