/**
 * scoring/seed-defaults.ts — Seed default scoring config + rules cho 1 org.
 *
 * Gọi khi org tạo lần đầu (signup) hoặc khi user kích hoạt Phase 6 trong
 * Settings (idempotent: skip nếu config đã tồn tại).
 *
 * Tạo:
 *   - 1 ScoringConfig row (weights + decay + flags)
 *   - 30+ ScoreSignalRule rows (từ DEFAULT_SIGNAL_RULES)
 *   - 5 StageTransitionRule rows
 *   - 5 StuckThreshold rows
 *   - 7 NbaTemplate rows
 *
 * Sau seed, tất cả tunable từ Settings UI (PR6).
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import {
  DEFAULT_SCORING_CONFIG,
  DEFAULT_SIGNAL_RULES,
  DEFAULT_STAGE_TRANSITIONS,
  DEFAULT_STUCK_THRESHOLDS,
  DEFAULT_NBA_TEMPLATES,
} from './constants.js';

export interface SeedResult {
  orgId: string;
  configCreated: boolean;
  signalRulesCreated: number;
  stageTransitionsCreated: number;
  stuckThresholdsCreated: number;
  nbaTemplatesCreated: number;
  skippedReason?: string;
}

/**
 * Seed defaults cho 1 org. Idempotent — skip rows đã tồn tại (by unique key).
 *
 * Pattern: createMany với skipDuplicates: false (manual check vì sqlite không support)
 * → query existing trước, filter ra rows mới, then createMany.
 */
export async function seedScoringDefaults(orgId: string): Promise<SeedResult> {
  const result: SeedResult = {
    orgId,
    configCreated: false,
    signalRulesCreated: 0,
    stageTransitionsCreated: 0,
    stuckThresholdsCreated: 0,
    nbaTemplatesCreated: 0,
  };

  // ── 1. ScoringConfig (1 row / org) ──────────────────────────────────────
  const existingConfig = await prisma.scoringConfig.findUnique({ where: { orgId } });
  if (!existingConfig) {
    await prisma.scoringConfig.create({
      data: {
        orgId,
        ...DEFAULT_SCORING_CONFIG,
      },
    });
    result.configCreated = true;
  }

  // ── 2. ScoreSignalRule (30+ rows) ───────────────────────────────────────
  const existingSignalKeys = new Set(
    (await prisma.scoreSignalRule.findMany({ where: { orgId }, select: { signalKey: true } })).map(
      (r) => r.signalKey
    )
  );
  const newSignalRules = DEFAULT_SIGNAL_RULES.filter(
    (r) => !existingSignalKeys.has(r.signalKey)
  ).map((r) => ({
    orgId,
    signalKey: r.signalKey,
    dimension: r.dimension,
    ruleType: r.ruleType,
    delta: r.delta,
    capPerDay: r.capPerDay ?? null,
    capTotal: r.capTotal ?? null,
    keywords: r.keywords ?? [],
    label: r.label,
    applicableStages: r.applicableStages ?? [],
    enabled: true,
  }));
  if (newSignalRules.length > 0) {
    await prisma.scoreSignalRule.createMany({ data: newSignalRules });
    result.signalRulesCreated = newSignalRules.length;
  }

  // ── 3. StageTransitionRule ──────────────────────────────────────────────
  const existingTransitions = new Set(
    (
      await prisma.stageTransitionRule.findMany({
        where: { orgId },
        select: { fromStage: true, toStage: true },
      })
    ).map((r) => `${r.fromStage}|${r.toStage}`)
  );
  const newTransitions = DEFAULT_STAGE_TRANSITIONS.filter(
    (t) => !existingTransitions.has(`${t.fromStage}|${t.toStage}`)
  ).map((t) => ({
    orgId,
    fromStage: t.fromStage,
    toStage: t.toStage,
    criteria: t.criteria as any,
    requiresManualConfirm: t.requiresManualConfirm,
    enabled: true,
  }));
  if (newTransitions.length > 0) {
    await prisma.stageTransitionRule.createMany({ data: newTransitions });
    result.stageTransitionsCreated = newTransitions.length;
  }

  // ── 4. StuckThreshold ───────────────────────────────────────────────────
  const existingStuckStages = new Set(
    (await prisma.stuckThreshold.findMany({ where: { orgId }, select: { stage: true } })).map(
      (r) => r.stage
    )
  );
  const newStuckThresholds = DEFAULT_STUCK_THRESHOLDS.filter(
    (t) => !existingStuckStages.has(t.stage)
  ).map((t) => ({
    orgId,
    stage: t.stage,
    thresholdDays: t.thresholdDays,
    extraDecayPerDay: t.extraDecayPerDay,
    nbaTemplateKey: t.nbaTemplateKey,
    alertLabel: t.alertLabel,
    enabled: true,
  }));
  if (newStuckThresholds.length > 0) {
    await prisma.stuckThreshold.createMany({ data: newStuckThresholds });
    result.stuckThresholdsCreated = newStuckThresholds.length;
  }

  // ── 5. NbaTemplate ──────────────────────────────────────────────────────
  const existingNbaKeys = new Set(
    (await prisma.nbaTemplate.findMany({ where: { orgId }, select: { key: true } })).map(
      (r) => r.key
    )
  );
  const newNbaTemplates = DEFAULT_NBA_TEMPLATES.filter((t) => !existingNbaKeys.has(t.key)).map(
    (t) => ({
      orgId,
      key: t.key,
      label: t.label,
      contentTemplate: t.contentTemplate,
      category: t.category,
      enabled: true,
    })
  );
  if (newNbaTemplates.length > 0) {
    await prisma.nbaTemplate.createMany({ data: newNbaTemplates });
    result.nbaTemplatesCreated = newNbaTemplates.length;
  }

  logger.info({ ...result }, 'Phase 6 scoring defaults seeded');

  return result;
}

/**
 * Helper: seed cho tất cả org chưa có config.
 * Dùng trong migration script chạy sau khi schema apply.
 */
export async function seedAllOrgs(): Promise<SeedResult[]> {
  const orgs = await prisma.organization.findMany({
    where: {
      scoringConfig: null,
    },
    select: { id: true },
  });

  const results: SeedResult[] = [];
  for (const org of orgs) {
    try {
      const result = await seedScoringDefaults(org.id);
      results.push(result);
    } catch (err) {
      logger.error({ orgId: org.id, err }, 'Failed to seed scoring defaults');
      results.push({
        orgId: org.id,
        configCreated: false,
        signalRulesCreated: 0,
        stageTransitionsCreated: 0,
        stuckThresholdsCreated: 0,
        nbaTemplatesCreated: 0,
        skippedReason: String(err),
      });
    }
  }

  return results;
}
