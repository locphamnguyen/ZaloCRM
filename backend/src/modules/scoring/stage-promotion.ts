// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/stage-promotion.ts — Auto-promote Friend giữa các stages.
 *
 * Trigger: gọi sau mỗi event có thể đẩy stage:
 *   - Friend.score change (qua score-engine.applySignalsToFriend)
 *   - Action milestone (appointment_create, appointment_complete, deposit, ...)
 *   - Inbound message count tăng
 *
 * Workflow:
 *   1. Load Friend hiện tại + current stage
 *   2. Lookup StageTransitionRule có fromStage = current
 *   3. Evaluate criteria (minEngagement, minIntent, requiresAction, ...)
 *   4. Nếu criteria match + !requiresManualConfirm + config.autoPromote:
 *        → update Friend.statusId + stageEnteredAt + log activity
 *        → trigger Contact aggregate (status MAX)
 *   5. Nếu requiresManualConfirm: tạo "pending promotion" notification cho sale
 *
 * Idempotent — gọi nhiều lần safe (kiểm tra hiện trạng trước khi promote).
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';
import { getScoringConfig } from './config-cache.js';
import { updateContactAggregateAsync } from './aggregate-contact.js';
import type { StageCriteria, ScoreBreakdown } from './types.js';

export interface PromotionResult {
  promoted: boolean;
  fromStage: string | null;
  toStage: string | null;
  reason: string;
}

/**
 * Evaluate + auto-promote 1 Friend nếu đạt criteria.
 *
 * @param friendId - target Friend
 * @returns PromotionResult với detail
 */
export async function evaluateAndPromote(friendId: string): Promise<PromotionResult> {
  try {
    const friend = await prisma.friend.findUnique({
      where: { id: friendId },
      select: {
        id: true,
        orgId: true,
        contactId: true,
        statusId: true,
        leadScore: true,
        scoreBreakdown: true,
        totalInbound: true,
        stageEnteredAt: true,
        statusRef: { select: { id: true, name: true, order: true } },
      },
    });
    if (!friend) {
      return { promoted: false, fromStage: null, toStage: null, reason: 'friend_not_found' };
    }

    const config = await getScoringConfig(friend.orgId);
    if (!config.autoPromote) {
      return {
        promoted: false,
        fromStage: friend.statusRef?.name ?? null,
        toStage: null,
        reason: 'auto_promote_disabled',
      };
    }

    const currentStageName = friend.statusRef?.name;
    if (!currentStageName) {
      // KH chưa có stage → assign default stage "Mới" (or skip)
      const defaultStatus = await prisma.status.findFirst({
        where: { orgId: friend.orgId, isDefault: true },
      });
      if (defaultStatus) {
        await prisma.friend.update({
          where: { id: friendId },
          data: { statusId: defaultStatus.id, stageEnteredAt: new Date() },
        });
        if (friend.contactId) updateContactAggregateAsync(friend.contactId);
        return {
          promoted: true,
          fromStage: null,
          toStage: defaultStatus.name,
          reason: 'assigned_default_stage',
        };
      }
      return { promoted: false, fromStage: null, toStage: null, reason: 'no_default_status' };
    }

    // Lookup rules fromStage = currentStage
    const rules = await prisma.stageTransitionRule.findMany({
      where: {
        orgId: friend.orgId,
        fromStage: currentStageName,
        enabled: true,
      },
    });
    if (rules.length === 0) {
      return {
        promoted: false,
        fromStage: currentStageName,
        toStage: null,
        reason: 'no_rules_for_stage',
      };
    }

    // Evaluate from highest priority order (typically only 1 rule per fromStage)
    for (const rule of rules) {
      const criteria = rule.criteria as StageCriteria;
      const match = await evaluateCriteria(friend, criteria);
      if (!match.matched) continue;

      // Find target status
      const toStatus = await prisma.status.findFirst({
        where: { orgId: friend.orgId, name: rule.toStage },
      });
      if (!toStatus) {
        logger.warn(
          { orgId: friend.orgId, toStage: rule.toStage },
          'Target stage status not found in DB'
        );
        continue;
      }

      if (rule.requiresManualConfirm) {
        // Tạo notification "pending promotion" — sale confirm trong UI (PR6).
        // Tạm log activity với action='stage_promote_suggested' (không update statusId)
        logActivity({
          orgId: friend.orgId,
          systemSource: 'scoring_engine',
          action: 'stage_promote_suggested',
          entityType: 'friend',
          entityId: friend.id,
          category: 'status_care',
          details: {
            fromStage: currentStageName,
            toStage: rule.toStage,
            criteria,
            evidence: match.evidence,
          },
        });
        return {
          promoted: false,
          fromStage: currentStageName,
          toStage: rule.toStage,
          reason: 'requires_manual_confirm',
        };
      }

      // Auto-promote
      await prisma.friend.update({
        where: { id: friendId },
        data: {
          statusId: toStatus.id,
          stageEnteredAt: new Date(),
        },
      });

      logActivity({
        orgId: friend.orgId,
        systemSource: 'scoring_engine',
        action: 'stage_promote_auto',
        entityType: 'friend',
        entityId: friend.id,
        category: 'status_care',
        details: {
          fromStage: currentStageName,
          toStage: rule.toStage,
          criteria,
          evidence: match.evidence,
        },
      });

      // Aggregate Contact (status MAX)
      if (friend.contactId) updateContactAggregateAsync(friend.contactId);

      return {
        promoted: true,
        fromStage: currentStageName,
        toStage: rule.toStage,
        reason: 'auto_promoted',
      };
    }

    return {
      promoted: false,
      fromStage: currentStageName,
      toStage: null,
      reason: 'criteria_not_met',
    };
  } catch (err) {
    logger.error({ friendId, err }, 'evaluateAndPromote failed');
    return { promoted: false, fromStage: null, toStage: null, reason: 'error' };
  }
}

/**
 * Fire-and-forget version cho callers không cần await.
 */
export function evaluateAndPromoteAsync(friendId: string): void {
  void evaluateAndPromote(friendId).catch((err) => {
    logger.error({ friendId, err }, 'evaluateAndPromoteAsync failed');
  });
}

/**
 * Manual promote — sale chọn stage thẳng từ UI (CareStatusBadge).
 * Log với actor=user (vs system trong auto-promote).
 */
export async function manualPromote(
  orgId: string,
  userId: string,
  friendId: string,
  newStatusId: string,
  reason?: string
): Promise<{ ok: boolean; fromStage: string | null; toStage: string | null; error?: string }> {
  try {
    const friend = await prisma.friend.findUnique({
      where: { id: friendId },
      select: {
        id: true,
        orgId: true,
        contactId: true,
        statusRef: { select: { name: true } },
      },
    });
    if (!friend) return { ok: false, fromStage: null, toStage: null, error: 'friend_not_found' };
    if (friend.orgId !== orgId)
      return { ok: false, fromStage: null, toStage: null, error: 'forbidden' };

    const newStatus = await prisma.status.findFirst({
      where: { id: newStatusId, orgId },
    });
    if (!newStatus)
      return {
        ok: false,
        fromStage: friend.statusRef?.name ?? null,
        toStage: null,
        error: 'status_not_found',
      };

    const fromStage = friend.statusRef?.name ?? null;

    await prisma.friend.update({
      where: { id: friendId },
      data: {
        statusId: newStatusId,
        stageEnteredAt: new Date(),
      },
    });

    logActivity({
      orgId,
      userId,
      action: 'stage_promote_manual',
      entityType: 'friend',
      entityId: friendId,
      category: 'status_care',
      details: { fromStage, toStage: newStatus.name, reason: reason ?? null },
    });

    if (friend.contactId) updateContactAggregateAsync(friend.contactId);

    return { ok: true, fromStage, toStage: newStatus.name };
  } catch (err) {
    logger.error({ friendId, newStatusId, err }, 'manualPromote failed');
    return { ok: false, fromStage: null, toStage: null, error: 'internal_error' };
  }
}

// ─── Internal: criteria evaluation ────────────────────────────────────────

interface CriteriaMatchResult {
  matched: boolean;
  evidence: Record<string, unknown>;
}

async function evaluateCriteria(
  friend: {
    id: string;
    orgId: string;
    leadScore: number;
    scoreBreakdown: any;
    totalInbound: number;
    stageEnteredAt: Date | null;
  },
  criteria: StageCriteria
): Promise<CriteriaMatchResult> {
  const evidence: Record<string, unknown> = {};
  const b = (friend.scoreBreakdown as Partial<ScoreBreakdown>) ?? {};

  if (criteria.minEngagement != null) {
    const eng = b.engagement ?? 0;
    evidence.engagement = eng;
    if (eng < criteria.minEngagement) return { matched: false, evidence };
  }
  if (criteria.minIntent != null) {
    const it = b.intent ?? 0;
    evidence.intent = it;
    if (it < criteria.minIntent) return { matched: false, evidence };
  }
  if (criteria.minFit != null) {
    const f = b.fit ?? 0;
    evidence.fit = f;
    if (f < criteria.minFit) return { matched: false, evidence };
  }
  if (criteria.minVelocity != null) {
    const v = b.velocity ?? 0;
    evidence.velocity = v;
    if (v < criteria.minVelocity) return { matched: false, evidence };
  }
  if (criteria.minFinalScore != null) {
    evidence.finalScore = friend.leadScore;
    if (friend.leadScore < criteria.minFinalScore) return { matched: false, evidence };
  }
  if (criteria.minInboundCount != null) {
    evidence.totalInbound = friend.totalInbound;
    if (friend.totalInbound < criteria.minInboundCount) return { matched: false, evidence };
  }
  if (criteria.minDaysInStage != null) {
    if (!friend.stageEnteredAt) {
      evidence.minDaysInStage = 'no_stageEnteredAt';
      return { matched: false, evidence };
    }
    const days = Math.floor((Date.now() - friend.stageEnteredAt.getTime()) / (24 * 3600 * 1000));
    evidence.daysInStage = days;
    if (days < criteria.minDaysInStage) return { matched: false, evidence };
  }
  if (criteria.requiresAction && criteria.requiresAction.length > 0) {
    // Kiểm tra ActivityLog có action này trong 30 ngày qua (signal milestone)
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const found = await prisma.activityLog.findFirst({
      where: {
        entityType: { in: ['friend', 'contact'] },
        entityId: friend.id, // friend.id; cũng có thể là contactId — query both
        action: { in: criteria.requiresAction },
        createdAt: { gte: since },
      },
      select: { action: true },
    });
    if (!found) {
      // Try contactId too (appointments logged on contact)
      const friendContact = await prisma.friend.findUnique({
        where: { id: friend.id },
        select: { contactId: true },
      });
      if (friendContact?.contactId) {
        const foundContact = await prisma.activityLog.findFirst({
          where: {
            entityType: 'contact',
            entityId: friendContact.contactId,
            action: { in: criteria.requiresAction },
            createdAt: { gte: since },
          },
          select: { action: true },
        });
        if (!foundContact) {
          evidence.requiresAction = 'not_found';
          return { matched: false, evidence };
        }
        evidence.requiresAction = foundContact.action;
      } else {
        evidence.requiresAction = 'not_found';
        return { matched: false, evidence };
      }
    } else {
      evidence.requiresAction = found.action;
    }
  }

  evidence.matched = true;
  return { matched: true, evidence };
}
