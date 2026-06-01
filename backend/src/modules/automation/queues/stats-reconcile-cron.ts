// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu Day 2 — Stats counter reconcile cron (2026-06-02)
// ════════════════════════════════════════════════════════════════════════
//
// Daily 02:30 VN cron (Section 23.3 design doc M10).
// Drift correction cho AutomationSequence cached counters:
//   - enrolledCountCached: count distinct contactId từ event sequence_step_enqueued step 0
//   - completedCountCached: count distinct contactId với event step_sent last step
//   - replyCountCached: count distinct contactId từ event customer_reply
//   - blockCountCached: count distinct contactId từ event customer_block
//
// Lý do reconcile: M3 + M5 hooks tăng counter atomic nhưng có thể miss khi:
//   - Worker crash giữa send và counter update
//   - Event log write thành công nhưng counter update fail
//   - Drift accumulate qua thời gian → admin nhìn KPI sai

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

// Convert UTC to VN time check
function shouldRunNow(now = new Date()): boolean {
  const vnHour = (now.getUTCHours() + 7) % 24;
  const vnMin = now.getUTCMinutes();
  // 02:30 VN
  return vnHour === 2 && vnMin >= 30 && vnMin < 35;
}

export async function reconcileSequenceCounters(): Promise<{
  sequencesUpdated: number;
  totalDrift: number;
}> {
  logger.info('[stats-reconcile] starting daily reconcile...');

  const sequences = await prisma.automationSequence.findMany({
    where: { enabled: true },
    select: { id: true, name: true, orgId: true },
  });

  let updated = 0;
  let totalDrift = 0;

  for (const seq of sequences) {
    // Find triggers linked to this sequence
    const triggers = await prisma.automationTrigger.findMany({
      where: {
        orgId: seq.orgId,
        OR: [{ sequenceId: seq.id }, { successorSequenceId: seq.id }],
      },
      select: { id: true },
    });
    const triggerIds = triggers.map((t) => t.id);

    if (triggerIds.length === 0) continue;

    // Aggregate raw counts từ event log
    const [enrolledLifetime, completedLifetime, replies, blocks] = await Promise.all([
      // enrolledCountCached: distinct contactId step 0 enqueued
      prisma.automationEventLog.findMany({
        where: {
          triggerId: { in: triggerIds },
          eventType: 'sequence_step_enqueued',
          detail: { contains: 'step 0/' },
        },
        select: { contactId: true },
        distinct: ['contactId'],
      }),
      // completedCountCached: distinct contactId với event step_sent ở last step
      // Approximation: count contactId từ sequence_step_sent → khó tách last step
      // → đơn giản: count distinct contactId từ event 'sequence_step_sent'
      prisma.automationEventLog.findMany({
        where: { triggerId: { in: triggerIds }, eventType: 'sequence_step_sent' },
        select: { contactId: true },
        distinct: ['contactId'],
      }),
      prisma.automationEventLog.findMany({
        where: { triggerId: { in: triggerIds }, eventType: 'customer_reply' },
        select: { contactId: true },
        distinct: ['contactId'],
      }),
      prisma.automationEventLog.findMany({
        where: { triggerId: { in: triggerIds }, eventType: 'customer_block' },
        select: { contactId: true },
        distinct: ['contactId'],
      }),
    ]);

    const enrolledCount = enrolledLifetime.filter((e) => e.contactId).length;
    const completedCount = completedLifetime.filter((e) => e.contactId).length;
    const replyCount = replies.filter((e) => e.contactId).length;
    const blockCount = blocks.filter((e) => e.contactId).length;

    // Read current cached
    const current = await prisma.automationSequence.findUnique({
      where: { id: seq.id },
      select: {
        enrolledCountCached: true,
        completedCountCached: true,
        replyCountCached: true,
        blockCountCached: true,
      },
    });
    if (!current) continue;

    const drift =
      Math.abs(current.enrolledCountCached - enrolledCount) +
      Math.abs(current.completedCountCached - completedCount) +
      Math.abs(current.replyCountCached - replyCount) +
      Math.abs(current.blockCountCached - blockCount);

    if (drift > 0) {
      await prisma.automationSequence.update({
        where: { id: seq.id },
        data: {
          enrolledCountCached: enrolledCount,
          completedCountCached: completedCount,
          replyCountCached: replyCount,
          blockCountCached: blockCount,
          countersLastSyncedAt: new Date(),
        },
      });
      logger.info(
        `[stats-reconcile] sequence ${seq.name} (${seq.id}) drift=${drift} reconciled ` +
          `enrolled=${enrolledCount} completed=${completedCount} reply=${replyCount} block=${blockCount}`,
      );
      updated++;
      totalDrift += drift;
    }
  }

  logger.info(
    `[stats-reconcile] done. ${updated}/${sequences.length} sequences updated, totalDrift=${totalDrift}`,
  );
  return { sequencesUpdated: updated, totalDrift };
}

// Cron loop helper — chạy mỗi phút check VN time
let cronHandle: NodeJS.Timeout | null = null;
let lastRunDate: string | null = null;

export function startStatsReconcileCron(): void {
  if (cronHandle) {
    logger.warn('[stats-reconcile] cron already started');
    return;
  }

  cronHandle = setInterval(() => {
    const now = new Date();
    const todayVN = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

    if (lastRunDate === todayVN) return; // đã chạy hôm nay rồi

    if (shouldRunNow(now)) {
      lastRunDate = todayVN;
      void reconcileSequenceCounters().catch((err) => {
        logger.error(`[stats-reconcile] cron error: ${(err as Error).message}`);
      });
    }
  }, 60_000); // check mỗi phút

  logger.info('[stats-reconcile] cron started (02:30 VN daily)');
}

export function stopStatsReconcileCron(): void {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
    logger.info('[stats-reconcile] cron stopped');
  }
}

// Manual trigger (RBAC admin endpoint M8 sẽ wire)
export async function manualReconcile(): Promise<ReturnType<typeof reconcileSequenceCounters>> {
  return reconcileSequenceCounters();
}
