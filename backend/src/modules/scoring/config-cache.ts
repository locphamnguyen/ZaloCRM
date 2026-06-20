// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/config-cache.ts — In-memory cache cho ScoringConfig + Signal Rules.
 *
 * Avoid DB query mỗi lần compute score. Cache key = orgId.
 * Invalidate khi Settings UI PUT config (PR6).
 *
 * TTL: 5 phút (auto-refresh nếu stale, fallback to direct DB on miss).
 */

import { prisma } from '../../shared/database/prisma-client.js';
import type { ScoringConfigSnapshot, SignalRuleType, ScoreDimension } from './types.js';
import { DEFAULT_SCORING_CONFIG } from './constants.js';

const TTL_MS = 5 * 60 * 1000; // 5 min

interface CachedSnapshot {
  config: ScoringConfigSnapshot;
  rules: CachedSignalRule[];
  expiresAt: number;
}

export interface CachedSignalRule {
  signalKey: string;
  dimension: ScoreDimension;
  ruleType: SignalRuleType;
  delta: number;
  capPerDay: number | null;
  capTotal: number | null;
  keywords: string[];
  label: string;
  applicableStages: string[];
  enabled: boolean;
}

const cache = new Map<string, CachedSnapshot>();

/**
 * Get scoring config snapshot cho 1 org. Cache miss → query DB.
 *
 * Nếu org chưa có config → return defaults (engine fall back to safe values).
 */
export async function getScoringConfig(orgId: string): Promise<ScoringConfigSnapshot> {
  const snap = await getSnapshot(orgId);
  return snap.config;
}

export async function getEnabledSignalRules(orgId: string): Promise<CachedSignalRule[]> {
  const snap = await getSnapshot(orgId);
  return snap.rules.filter((r) => r.enabled);
}

export async function findRuleByKey(
  orgId: string,
  signalKey: string
): Promise<CachedSignalRule | null> {
  const snap = await getSnapshot(orgId);
  return snap.rules.find((r) => r.signalKey === signalKey) ?? null;
}

/**
 * Find rules of a specific type (for engine to iterate detection).
 */
export async function getRulesByType(
  orgId: string,
  ruleType: SignalRuleType
): Promise<CachedSignalRule[]> {
  const snap = await getSnapshot(orgId);
  return snap.rules.filter((r) => r.enabled && r.ruleType === ruleType);
}

/**
 * Invalidate cache cho 1 org. Gọi sau khi Settings UI PUT config/rule.
 */
export function invalidateCache(orgId: string): void {
  cache.delete(orgId);
}

/**
 * Invalidate tất cả (vd khi schema migrate / restart).
 */
export function invalidateAll(): void {
  cache.clear();
}

// ── Internal ────────────────────────────────────────────────────────────────

async function getSnapshot(orgId: string): Promise<CachedSnapshot> {
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const snap = await loadFromDb(orgId);
  cache.set(orgId, snap);
  return snap;
}

async function loadFromDb(orgId: string): Promise<CachedSnapshot> {
  const [configRow, rules] = await Promise.all([
    prisma.scoringConfig.findUnique({ where: { orgId } }),
    prisma.scoreSignalRule.findMany({ where: { orgId } }),
  ]);

  const config: ScoringConfigSnapshot = {
    orgId,
    weights: {
      engagement: configRow?.weightEngagement ?? DEFAULT_SCORING_CONFIG.weightEngagement,
      intent: configRow?.weightIntent ?? DEFAULT_SCORING_CONFIG.weightIntent,
      fit: configRow?.weightFit ?? DEFAULT_SCORING_CONFIG.weightFit,
      velocity: configRow?.weightVelocity ?? DEFAULT_SCORING_CONFIG.weightVelocity,
    },
    decay: {
      day3to7: configRow?.decayDay3to7 ?? DEFAULT_SCORING_CONFIG.decayDay3to7,
      day7to14: configRow?.decayDay7to14 ?? DEFAULT_SCORING_CONFIG.decayDay7to14,
      day14to30: configRow?.decayDay14to30 ?? DEFAULT_SCORING_CONFIG.decayDay14to30,
      day30to60: configRow?.decayDay30to60 ?? DEFAULT_SCORING_CONFIG.decayDay30to60,
    },
    autoPromote: configRow?.autoPromote ?? DEFAULT_SCORING_CONFIG.autoPromote,
    stuckDetectionEnabled:
      configRow?.stuckDetectionEnabled ?? DEFAULT_SCORING_CONFIG.stuckDetectionEnabled,
    explainabilityEnabled:
      configRow?.explainabilityEnabled ?? DEFAULT_SCORING_CONFIG.explainabilityEnabled,
  };

  const cachedRules: CachedSignalRule[] = rules.map((r) => ({
    signalKey: r.signalKey,
    dimension: r.dimension as ScoreDimension,
    ruleType: r.ruleType as SignalRuleType,
    delta: r.delta,
    capPerDay: r.capPerDay,
    capTotal: r.capTotal,
    keywords: (r.keywords as string[]) ?? [],
    label: r.label,
    applicableStages: (r.applicableStages as string[]) ?? [],
    enabled: r.enabled,
  }));

  return {
    config,
    rules: cachedRules,
    expiresAt: Date.now() + TTL_MS,
  };
}
