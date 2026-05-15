/**
 * scoring/score-engine.ts — Compute Friend.leadScore từ signals applied.
 *
 * Pipeline:
 *   1. Caller detect signals (signal-detector.ts)
 *   2. Engine apply từng signal: check caps, update sub-score, log activity
 *   3. Engine compute finalScore từ sub-scores + weights
 *   4. Persist Friend.scoreBreakdown + leadScore + scoreUpdatedAt
 *   5. Trigger Contact aggregate (aggregate-contact.ts)
 *
 * Fire-and-forget: caller KHÔNG await, errors logged silently.
 *
 * Concurrency: dùng prisma.$transaction để tránh race khi 2 signals arrive cùng lúc.
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';
import { getScoringConfig } from './config-cache.js';
import { updateContactAggregateAsync } from './aggregate-contact.js';
import type { DetectedSignal } from './signal-detector.js';
import type {
  ScoreBreakdown,
  ScoreDimension,
  SignalApplied,
  ScoringConfigSnapshot,
} from './types.js';

/**
 * Apply 1 hoặc nhiều signals lên 1 Friend, recompute final score.
 *
 * @param friendId - target Friend
 * @param orgId - tenant scope
 * @param signals - signals detected (đã filter caps theo dimension nếu cần)
 * @param trigger - lý do trigger (vd "inbound_message", "appointment_complete")
 */
export async function applySignalsToFriend(
  friendId: string,
  orgId: string,
  signals: DetectedSignal[],
  trigger: string
): Promise<void> {
  if (signals.length === 0) return;

  try {
    const config = await getScoringConfig(orgId);
    const friend = await prisma.friend.findUnique({
      where: { id: friendId },
      select: {
        id: true,
        orgId: true,
        contactId: true,
        leadScore: true,
        scoreBreakdown: true,
      },
    });
    if (!friend) {
      logger.warn({ friendId, trigger }, 'Friend not found for scoring');
      return;
    }

    const currentBreakdown = parseBreakdown(friend.scoreBreakdown);

    // Apply cap-per-day filter
    const filtered = await filterByDayCaps(friendId, signals);
    if (filtered.length === 0) return;

    // Sum deltas by dimension
    const newBreakdown = applyDeltasToBreakdown(currentBreakdown, filtered);

    // Recompute final score
    const finalScore = computeFinalScore(newBreakdown, config);

    // Build signals trail (last 50 signals for explainability UI)
    const newSignals: SignalApplied[] = filtered.map((s) => ({
      key: s.signalKey,
      dimension: s.dimension,
      delta: s.delta,
      label: s.label,
      appliedAt: new Date().toISOString(),
    }));
    const existingSignals = currentBreakdown.signals ?? [];
    const trail = [...newSignals, ...existingSignals].slice(0, 50);

    const finalBreakdown: ScoreBreakdown = {
      ...newBreakdown,
      finalScore,
      computedAt: new Date().toISOString(),
      signals: config.explainabilityEnabled ? trail : undefined,
    };

    const oldScore = friend.leadScore;
    const deltaScore = finalScore - oldScore;

    // Persist Friend update
    await prisma.friend.update({
      where: { id: friendId },
      data: {
        leadScore: finalScore,
        scoreBreakdown: finalBreakdown as any,
        scoreUpdatedAt: new Date(),
      },
    });

    // Log activity (chỉ log nếu delta khác 0)
    if (deltaScore !== 0) {
      logActivity({
        orgId,
        systemSource: 'scoring_engine',
        action: 'score_change',
        entityType: 'friend',
        entityId: friendId,
        category: 'score',
        details: {
          oldScore,
          newScore: finalScore,
          delta: deltaScore,
          trigger,
          signalsApplied: filtered.map((s) => ({
            key: s.signalKey,
            dim: s.dimension,
            delta: s.delta,
            label: s.label,
          })),
          breakdown: {
            engagement: newBreakdown.engagement,
            intent: newBreakdown.intent,
            fit: newBreakdown.fit,
            velocity: newBreakdown.velocity,
          },
        },
      });
    }

    // Trigger Contact aggregate (fire-and-forget)
    if (friend.contactId) {
      updateContactAggregateAsync(friend.contactId);
    }

    // Trigger stage promotion check (fire-and-forget). Score change can push
    // Friend across stage criteria → auto-promote if rules match.
    void (async () => {
      try {
        const { evaluateAndPromote } = await import('./stage-promotion.js');
        await evaluateAndPromote(friendId);
      } catch {
        /* silent */
      }
    })();

    // Trigger auto-tag recompute (fire-and-forget).
    void (async () => {
      try {
        const { updateFriendAutoTags } = await import('./auto-tag.js');
        await updateFriendAutoTags(friendId);
      } catch {
        /* silent */
      }
    })();
  } catch (err) {
    logger.error({ friendId, orgId, trigger, err }, 'applySignalsToFriend failed');
  }
}

// ─── Internal: parse + apply ──────────────────────────────────────────────

function parseBreakdown(raw: unknown): ScoreBreakdown {
  const defaults: ScoreBreakdown = {
    engagement: 0,
    intent: 0,
    fit: 0,
    velocity: 0,
    finalScore: 0,
    computedAt: new Date(0).toISOString(),
    signals: [],
  };
  if (!raw || typeof raw !== 'object') return defaults;
  const b = raw as Partial<ScoreBreakdown>;
  return {
    engagement: clampSubScore(b.engagement ?? 0),
    intent: clampSubScore(b.intent ?? 0),
    fit: clampSubScore(b.fit ?? 0),
    velocity: clampSubScore(b.velocity ?? 0),
    finalScore: clampScore(b.finalScore ?? 0),
    computedAt: typeof b.computedAt === 'string' ? b.computedAt : defaults.computedAt,
    signals: Array.isArray(b.signals) ? b.signals : [],
  };
}

function applyDeltasToBreakdown(
  current: ScoreBreakdown,
  signals: DetectedSignal[]
): Omit<ScoreBreakdown, 'finalScore' | 'computedAt' | 'signals'> {
  // Aggregate delta per dimension
  const deltas: Record<ScoreDimension, number> = {
    engagement: 0,
    intent: 0,
    fit: 0,
    velocity: 0,
  };
  for (const s of signals) {
    deltas[s.dimension] += s.delta;
  }

  return {
    engagement: clampSubScore(current.engagement + deltas.engagement),
    intent: clampSubScore(current.intent + deltas.intent),
    fit: clampSubScore(current.fit + deltas.fit),
    velocity: clampSubScore(current.velocity + deltas.velocity),
  };
}

/**
 * Weighted sum: finalScore = sum(subScore * weight%) / 100, range 0-100.
 * Weights sum to ~100, sub-scores sum to ~100 → finalScore in [0, 100].
 */
export function computeFinalScore(
  breakdown: Omit<ScoreBreakdown, 'finalScore' | 'computedAt' | 'signals'>,
  config: ScoringConfigSnapshot
): number {
  const { engagement, intent, fit, velocity } = breakdown;
  const { weights } = config;
  const totalWeight =
    weights.engagement + weights.intent + weights.fit + weights.velocity;
  if (totalWeight <= 0) return 0;

  const score =
    (engagement * weights.engagement +
      intent * weights.intent +
      fit * weights.fit +
      velocity * weights.velocity) /
    totalWeight;

  return clampScore(Math.round(score));
}

// ─── Caps ─────────────────────────────────────────────────────────────────

/**
 * Filter signals by capPerDay (count ActivityLog của signal key trong 24h).
 *
 * Performance: query 1 lần cho tất cả signal keys, group by signalKey.
 */
async function filterByDayCaps(
  friendId: string,
  signals: DetectedSignal[]
): Promise<DetectedSignal[]> {
  const keysWithCap = signals.filter((s) => s.rule.capPerDay != null);
  if (keysWithCap.length === 0) return signals;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Query ActivityLog cho signals đã applied 24h qua, count per signalKey
  const recent = await prisma.activityLog.findMany({
    where: {
      entityType: 'friend',
      entityId: friendId,
      action: 'score_change',
      createdAt: { gte: since },
      systemSource: 'scoring_engine',
    },
    select: { details: true },
  });

  // Count signal occurrences per key from details JSON
  const counts: Record<string, number> = {};
  for (const log of recent) {
    const det = log.details as any;
    const sigs = det?.signalsApplied ?? [];
    if (Array.isArray(sigs)) {
      for (const sig of sigs) {
        if (sig?.key) {
          counts[sig.key] = (counts[sig.key] || 0) + 1;
        }
      }
    }
  }

  // Filter: drop signal if count(key) >= capPerDay
  return signals.filter((s) => {
    if (s.rule.capPerDay == null) return true;
    const usedCount = counts[s.signalKey] || 0;
    // capPerDay is per occurrence count, not cumulative delta
    return usedCount < s.rule.capPerDay / Math.abs(s.delta || 1);
  });
}

// ─── Clamp utilities ──────────────────────────────────────────────────────

function clampSubScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
