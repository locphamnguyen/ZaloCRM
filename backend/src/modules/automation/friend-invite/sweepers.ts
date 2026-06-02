// Phase Friend Invite Queue 2026-05-28 — 3 cron sweepers + outbox drainer.
//
// 1. Stuck sweeper (1 phút):
//    UPDATE entries SET queueStatus='queued_for_pickup' WHERE queueStatus='processing'
//    AND lockedAt < NOW() - INTERVAL '5 minutes'
//    Increment stuckRecoveryCount. After 10 recoveries → failed_stuck.
//
// 2. Trigger completion sweeper (1 phút):
//    UPDATE triggers SET state='completed' WHERE state='active' AND pool empty.
//
// 3. Outbox drainer (30s):
//    Pick FriendRequestOutbox WHERE sendStatus='success' AND sequenceMaterializedAt IS NULL
//    Call materializeSequenceForContact() per row → UPDATE sequenceMaterializedAt.

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { materializeSequenceForContact } from '../engine/campaign-materializer.js';

let stuckSweeperInterval: NodeJS.Timeout | null = null;
let triggerSweeperInterval: NodeJS.Timeout | null = null;
let exhaustedSweeperInterval: NodeJS.Timeout | null = null;
let drainerInterval: NodeJS.Timeout | null = null;

/**
 * Stuck sweeper — release entries stuck >5min back to pool.
 */
async function runStuckSweeper(): Promise<void> {
  try {
    // Release stuck entries + increment recovery count
    const result = await prisma.$executeRaw`
      UPDATE customer_list_entries
      SET queue_status = 'queued_for_pickup',
          claimed_by_nick_id = NULL,
          locked_at = NULL,
          stuck_recovery_count = stuck_recovery_count + 1
      WHERE queue_status = 'processing'
        AND locked_at < NOW() - INTERVAL '5 minutes'
        AND stuck_recovery_count < 10
    `;
    if (result > 0) {
      logger.info(`[stuck-sweeper] released ${result} stuck entries back to pool`);
    }

    // Mark entries that hit 10 recoveries as failed_stuck
    const failedStuck = await prisma.$executeRaw`
      UPDATE customer_list_entries
      SET queue_status = 'failed_stuck'
      WHERE queue_status = 'processing'
        AND locked_at < NOW() - INTERVAL '5 minutes'
        AND stuck_recovery_count >= 10
    `;
    if (failedStuck > 0) {
      logger.warn(`[stuck-sweeper] ${failedStuck} entries marked failed_stuck after 10 recoveries`);
    }
  } catch (err) {
    logger.error('[stuck-sweeper] error:', err);
  }
}

/**
 * Trigger completion sweeper — flip state='completed' khi pool empty.
 */
async function runTriggerCompletionSweeper(): Promise<void> {
  try {
    const result = await prisma.$executeRaw`
      UPDATE automation_triggers
      SET state = 'completed', updated_at = NOW()
      WHERE state = 'active'
        AND event_type = 'friend_invite_to_list'
        AND id IN (
          SELECT t.id FROM automation_triggers t
          LEFT JOIN customer_list_entries e ON e.trigger_id = t.id
          WHERE t.state = 'active'
            AND t.event_type = 'friend_invite_to_list'
          GROUP BY t.id
          HAVING COUNT(e.id) > 0
            AND COUNT(*) FILTER (WHERE e.queue_status IN ('queued_for_pickup', 'processing')) = 0
        )
    `;
    if (result > 0) {
      logger.info(`[trigger-sweeper] flipped ${result} triggers to state='completed'`);
    }
  } catch (err) {
    logger.error('[trigger-sweeper] error:', err);
  }
}

/**
 * Exhausted-nicks sweeper — flip queued_for_pickup → failed_permanent
 * khi failedNickIds đã cover hết trigger.segmentSpec.nickIds.
 *
 * Lý do tách sweep: releaseEntryFailed mark failed_permanent ngay khi release,
 * nhưng entries từ trước fix này (hoặc race window) có thể stuck queued_for_pickup
 * mà không entry nào claim được (vì NOT (failedNickIds @> nickId) loại hết).
 */
async function runExhaustedNicksSweeper(): Promise<void> {
  try {
    const result = await prisma.$executeRaw`
      UPDATE customer_list_entries e
      SET queue_status = 'failed_permanent'
      FROM automation_triggers t
      WHERE e.trigger_id = t.id
        AND e.queue_status = 'queued_for_pickup'
        AND t.event_type = 'friend_invite_to_list'
        AND jsonb_array_length(e.failed_nick_ids) >= jsonb_array_length(t.segment_spec->'nickIds')
        AND jsonb_array_length(t.segment_spec->'nickIds') > 0
    `;
    if (result > 0) {
      logger.warn(`[exhausted-sweeper] ${result} entries marked failed_permanent (all trigger nicks failed)`);
    }
  } catch (err) {
    logger.error('[exhausted-sweeper] error:', err);
  }
}

/**
 * Outbox drainer — materialize sequence campaigns for outbox rows.
 */
async function runOutboxDrainer(): Promise<void> {
  try {
    // Pick rows with sequence_materialized_at IS NULL, exclude rows already 5 attempts (alert state)
    // Wave 2: Gate sequence enrollment by welcome success. KH chặn tin lạ (BLOCKED_STRANGER) hoặc fail cứng (HARD_FAIL) sẽ KHÔNG enroll.
    const rows = await prisma.friendRequestOutbox.findMany({
      where: {
        kind: 'WELCOME_PROBE',
        welcomeOutcome: { in: ['SENT_STRANGER', 'SENT_FRIEND'] },
        sequenceMaterializedAt: null,
        successorSequenceId: { not: null },
        attemptCount: { lt: 5 },
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    if (rows.length === 0) return;

    let materialized = 0;
    for (const row of rows) {
      try {
        // Look up trigger to get orgId + ruleOverrides
        const trigger = await prisma.automationTrigger.findUnique({
          where: { id: row.triggerId },
          select: { orgId: true, ruleOverrides: true },
        });
        if (!trigger) {
          logger.warn(`[outbox-drainer] trigger ${row.triggerId} not found for outbox row ${row.id}`);
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              attemptCount: { increment: 1 },
              lastErrorMessage: 'trigger missing',
            },
          });
          continue;
        }

        const result = await materializeSequenceForContact({
          orgId: trigger.orgId,
          contactId: row.contactId,
          sequenceId: row.successorSequenceId!,
          triggerId: row.triggerId,
          assignedNickId: row.nickId,
          originTaskId: row.customerListEntryId,
          sequenceSnapshot: (row.sequenceVersionSnapshot ?? null) as never,
          ruleOverrides: trigger.ruleOverrides as Record<string, unknown> | null,
        });

        if (result.skipped) {
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              attemptCount: { increment: 1 },
              lastErrorMessage: result.reason ?? 'skipped',
            },
          });
        } else {
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              sequenceMaterializedAt: new Date(),
            },
          });
          materialized++;
        }
      } catch (err: any) {
        logger.error(`[outbox-drainer] materialize failed for outbox row ${row.id}:`, err);
        await prisma.friendRequestOutbox.update({
          where: { id: row.id },
          data: {
            attemptCount: { increment: 1 },
            lastErrorMessage: (err?.message ?? String(err)).slice(0, 500),
          },
        });
      }
    }

    if (materialized > 0) {
      logger.info(`[outbox-drainer] materialized ${materialized}/${rows.length} sequence campaigns`);
    }

    // Alert on rows with attemptCount >= 5
    const stuck = await prisma.friendRequestOutbox.count({
      where: {
        sequenceMaterializedAt: null,
        attemptCount: { gte: 5 },
      },
    });
    if (stuck > 0) {
      logger.warn(`[outbox-drainer] ALERT: ${stuck} outbox rows stuck (>=5 attempts) — manual review needed`);
    }
  } catch (err) {
    logger.error('[outbox-drainer] error:', err);
  }
}

/**
 * Welcome-failed cleanup — mark BLOCKED_STRANGER / HARD_FAIL rows with
 * sequenceMaterializedAt = sentAt so they exit poll set, but keep for analytics.
 */
async function runWelcomeFailedCleanup(): Promise<void> {
  try {
    // Qualify every column reference with the alias so Postgres cannot mis-resolve
    // welcome_sent_at to an ambiguous `sent_at` (the prior P2010 42703 was caused
    // by an unqualified reference that the parser hinted to a non-existent column).
    // Switch to Prisma model-level updateMany so the column names go through the
    // generated client (no raw SQL drift after migrations).
    const { count } = await prisma.friendRequestOutbox.updateMany({
      where: {
        kind: 'WELCOME_PROBE',
        welcomeOutcome: { in: ['BLOCKED_STRANGER', 'HARD_FAIL'] },
        sequenceMaterializedAt: null,
      },
      data: {
        sequenceMaterializedAt: new Date(),
      },
    });
    if (count > 0) {
      logger.info(`[welcome-failed-cleanup] retired ${count} BLOCKED_STRANGER/HARD_FAIL rows from poll set`);
    }
  } catch (err) {
    logger.error('[welcome-failed-cleanup] error:', err);
  }
}

let welcomeFailedCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start all 3 sweepers.
 */
export function startFriendInviteSweepers(): void {
  if (stuckSweeperInterval || triggerSweeperInterval || exhaustedSweeperInterval || drainerInterval || welcomeFailedCleanupInterval) {
    logger.warn('[friend-invite] sweepers already running, skip start');
    return;
  }

  stuckSweeperInterval = setInterval(() => void runStuckSweeper(), 60_000);
  triggerSweeperInterval = setInterval(() => void runTriggerCompletionSweeper(), 60_000);
  exhaustedSweeperInterval = setInterval(() => void runExhaustedNicksSweeper(), 60_000);
  drainerInterval = setInterval(() => void runOutboxDrainer(), 30_000);
  welcomeFailedCleanupInterval = setInterval(() => void runWelcomeFailedCleanup(), 60_000);

  logger.info('[friend-invite] sweepers started: stuck(60s) + trigger-complete(60s) + exhausted-nicks(60s) + outbox-drainer(30s) + welcome-failed-cleanup(60s)');

  // Initial run on start
  void runStuckSweeper();
  void runExhaustedNicksSweeper();
  void runTriggerCompletionSweeper();
  void runOutboxDrainer();
  void runWelcomeFailedCleanup();
}

/**
 * Stop all sweepers (graceful shutdown).
 */
export function stopFriendInviteSweepers(): void {
  if (stuckSweeperInterval) clearInterval(stuckSweeperInterval);
  if (triggerSweeperInterval) clearInterval(triggerSweeperInterval);
  if (exhaustedSweeperInterval) clearInterval(exhaustedSweeperInterval);
  if (drainerInterval) clearInterval(drainerInterval);
  if (welcomeFailedCleanupInterval) clearInterval(welcomeFailedCleanupInterval);
  stuckSweeperInterval = null;
  triggerSweeperInterval = null;
  exhaustedSweeperInterval = null;
  drainerInterval = null;
  welcomeFailedCleanupInterval = null;
  logger.info('[friend-invite] sweepers stopped');
}
