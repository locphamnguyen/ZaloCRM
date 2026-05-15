/**
 * scoring/scoring-scheduler.ts — Background scheduler cho Phase 6 jobs.
 *
 * 2 jobs:
 *   1. Decay cron — chạy mỗi giờ. Apply silent decay cho Friend lâu không inbound.
 *   2. Stuck detection — chạy daily 6am. Flag KH stuck per-stage threshold.
 *
 * Pattern: setInterval với jitter để tránh thundering herd ở multi-instance deploy.
 * Production-grade scheduler (BullMQ / agenda) có thể add sau nếu cần.
 */

import { logger } from '../../shared/utils/logger.js';
import { runDecayAllOrgs } from './decay-cron.js';
import { runStuckDetectionAllOrgs } from './stuck-detection.js';
import { runAutoTagsAllOrgs } from './auto-tag.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let decayTimer: NodeJS.Timeout | null = null;
let stuckTimer: NodeJS.Timeout | null = null;
let autoTagTimer: NodeJS.Timeout | null = null;

/**
 * Start scheduler. Idempotent — call once at app boot.
 *
 * @param opts.decayIntervalMs - default 1 hour
 * @param opts.stuckRunHourLocal - hour 0-23 to trigger daily scan (default 6 = 6am)
 */
export function startScoringScheduler(opts?: {
  decayIntervalMs?: number;
  stuckRunHourLocal?: number;
  enabled?: boolean;
}): void {
  if (opts?.enabled === false) {
    logger.info('Scoring scheduler disabled via config');
    return;
  }

  const decayInterval = opts?.decayIntervalMs ?? HOUR_MS;
  const stuckHour = opts?.stuckRunHourLocal ?? 6;

  // ── Decay: every hour, jittered up to 1 min ──────────────────────────
  if (decayTimer) clearInterval(decayTimer);
  const decayJitter = Math.floor(Math.random() * 60_000);
  decayTimer = setInterval(
    () => {
      void runDecayJob();
    },
    decayInterval + decayJitter
  );
  logger.info({ decayIntervalMs: decayInterval }, 'Scoring decay scheduler started');

  // ── Stuck detection: daily at stuckHour ───────────────────────────────
  if (stuckTimer) clearInterval(stuckTimer);
  const stuckMs = msUntilNextHourMatch(stuckHour);
  setTimeout(() => {
    void runStuckJob();
    // After first run, schedule every 24h
    stuckTimer = setInterval(() => {
      void runStuckJob();
    }, DAY_MS);
  }, stuckMs);
  logger.info(
    { stuckRunHourLocal: stuckHour, firstRunInMs: stuckMs },
    'Stuck detection scheduler started'
  );

  // ── Auto-tag: daily at stuckHour+1 (run sau stuck detection để dùng latest stuckSince) ──
  if (autoTagTimer) clearInterval(autoTagTimer);
  const autoTagMs = msUntilNextHourMatch((stuckHour + 1) % 24);
  setTimeout(() => {
    void runAutoTagJob();
    autoTagTimer = setInterval(() => {
      void runAutoTagJob();
    }, DAY_MS);
  }, autoTagMs);
  logger.info({ firstRunInMs: autoTagMs }, 'Auto-tag scheduler started');
}

export function stopScoringScheduler(): void {
  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
  }
  if (stuckTimer) {
    clearInterval(stuckTimer);
    stuckTimer = null;
  }
  if (autoTagTimer) {
    clearInterval(autoTagTimer);
    autoTagTimer = null;
  }
}

async function runAutoTagJob(): Promise<void> {
  try {
    const start = Date.now();
    const results = await runAutoTagsAllOrgs();
    const totalChanged = results.reduce((sum, r) => sum + r.changed, 0);
    logger.info(
      { totalChanged, orgs: results.length, ms: Date.now() - start },
      'Auto-tag batch completed'
    );
  } catch (err) {
    logger.error({ err }, 'Auto-tag job failed');
  }
}

async function runDecayJob(): Promise<void> {
  try {
    const start = Date.now();
    const results = await runDecayAllOrgs();
    const totalDecayed = results.reduce((sum, r) => sum + r.decayed, 0);
    logger.info(
      { totalDecayed, orgs: results.length, ms: Date.now() - start },
      'Decay job batch completed'
    );
  } catch (err) {
    logger.error({ err }, 'Decay job failed');
  }
}

async function runStuckJob(): Promise<void> {
  try {
    const start = Date.now();
    const results = await runStuckDetectionAllOrgs();
    const totalNewlyStuck = results.reduce((sum, r) => sum + r.newlyStuck, 0);
    const totalUnstuck = results.reduce((sum, r) => sum + r.unstuck, 0);
    logger.info(
      { totalNewlyStuck, totalUnstuck, orgs: results.length, ms: Date.now() - start },
      'Stuck detection batch completed'
    );
  } catch (err) {
    logger.error({ err }, 'Stuck detection failed');
  }
}

function msUntilNextHourMatch(targetHour: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(targetHour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}
