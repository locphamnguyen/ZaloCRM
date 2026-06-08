// Phase 7 — Cron event scheduler.
//
// Unlocks 2 trigger event types that were declared in the catalog but had no
// emission source until now:
//   - 'birthday'        — fires daily at 08:00 Asia/Ho_Chi_Minh for every
//                         contact whose Contact.birthDate matches today (MM-DD).
//                         Per-contact emit so triggers/sequences process each
//                         birthday individually.
//   - 'scheduled_cron'  — fires per-trigger based on the cron expression stored
//                         in AutomationTrigger.eventFilter.cron. Org-scoped emit
//                         (no contactId) → materializer resolves trigger.segmentSpec.
//
// node-cron is already a project dep (used by friend-sync-cron). Reuse it for
// consistency.
//
// Hot-reload: registerCronTrigger() / unregisterCronTrigger() let trigger routes
// invalidate the schedule registry when a trigger is created/updated/enabled.
// Without this, a new scheduled_cron trigger wouldn't fire until next reboot.

import cron from 'node-cron';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { automationEventBus } from './event-bus.js';
import { cleanupOldEvents, logEvent } from '../friend-invite/event-log-service.js';
import {
  precomputeAndSeedPool,
  isFriendInviteSegmentSpec,
} from '../friend-invite/skip-precompute.js';
import { startNickWorker } from '../friend-invite/nick-worker.js';
import {
  sweepSilentCareSessions,
  reconcileMissingSequenceStart,
} from '../care-session/care-session-service.js';

const TZ = 'Asia/Ho_Chi_Minh';

// Map<triggerId, ScheduledTask> — for hot-reload
const cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();

let birthdayJob: ReturnType<typeof cron.schedule> | null = null;
// Wave 3 Day 5 — daily cleanup AutomationEventLog (retention 30 ngày)
let eventLogCleanupJob: ReturnType<typeof cron.schedule> | null = null;
// BE T4 2026-05-30 — friend-invite scheduled trigger activator (every 5 min)
let scheduledTriggerJob: ReturnType<typeof cron.schedule> | null = null;
// P2 Wave 4 2026-06-03 — Tạm dừng có TTL → cron auto-resume mỗi 1 phút.
let pausedUntilSweepJob: ReturnType<typeof cron.schedule> | null = null;
// CareSession 2026-06-07 (T6) — janitor đóng phiên im-lặng (5 phút) + reconcile (2 phút).
let careSessionJanitorJob: ReturnType<typeof cron.schedule> | null = null;
let careSessionReconcileJob: ReturnType<typeof cron.schedule> | null = null;
let isStarted = false;

// ── Public API ─────────────────────────────────────────────────────────────

export async function startCronEventScheduler(): Promise<void> {
  if (isStarted) {
    logger.warn('[cron-scheduler] already started');
    return;
  }
  isStarted = true;

  // Birthday — daily 8am VN
  birthdayJob = cron.schedule('0 8 * * *', () => { void fireBirthdayEvents(); }, { timezone: TZ });
  logger.info('[cron-scheduler] birthday job registered (daily 08:00 ' + TZ + ')');

  // Wave 3 Day 5 — AutomationEventLog cleanup daily 03:00 VN (UTC 20:00 prev day).
  // Retention 30 ngày, gọi cleanupOldEvents(30) — xem
  // friend-invite/event-log-service.ts. Fire-and-forget; lỗi swallow internally.
  eventLogCleanupJob = cron.schedule(
    '0 3 * * *',
    () => { void cleanupOldEvents(30); },
    { timezone: TZ },
  );
  logger.info('[cron-scheduler] event-log cleanup job registered (daily 03:00 ' + TZ + ', retention 30d)');

  // Scheduled_cron — load all enabled triggers, register each
  await reloadAllScheduledCronTriggers();

  // BE T4 2026-05-30 — Friend-invite scheduled triggers activator.
  // Every 5 min sweep: pick draft triggers whose scheduledAt is due (server NOW),
  // transactionally flip → active, then precompute pool + spawn nick workers.
  // KHÔNG dùng node-cron timezone vì so sánh thuần UTC với DB NOW(); server-side time.
  scheduledTriggerJob = cron.schedule(
    '*/5 * * * *',
    () => { void activateScheduledTriggers(); },
    { timezone: TZ },
  );
  logger.info('[cron-scheduler] scheduled-trigger activator registered (every 5 min ' + TZ + ')');

  // P2 Wave 4 2026-06-03 — Paused-until sweeper. Mỗi 1 phút sweep
  // AutomationTrigger state='paused' AND pausedUntil <= NOW() → flip back active
  // + clear pausedUntil + spawn nick workers (idempotent). Fine-grained (1 min)
  // vì user kỳ vọng "Tạm dừng 24h" trở lại đúng ~24h sau, không trượt quá nhiều.
  pausedUntilSweepJob = cron.schedule(
    '* * * * *',
    () => { void resumePausedTriggers(); },
    { timezone: TZ },
  );
  logger.info('[cron-scheduler] paused-until sweeper registered (every 1 min ' + TZ + ')');

  // CareSession 2026-06-07 (T6) — Janitor đóng phiên im-lặng quá hạn (mỗi 5 phút,
  // đủ — im lặng 7 ngày không cần độ chính xác phút). Set-based UPDATE + isRunning
  // guard nội bộ chống overlap. D5: tải thật ~1-2k phiên, không cần batch.
  careSessionJanitorJob = cron.schedule(
    '*/5 * * * *',
    () => { void sweepSilentCareSessions(); },
    { timezone: TZ },
  );
  logger.info('[cron-scheduler] care-session janitor registered (every 5 min ' + TZ + ')');

  // CareSession reconcile (D2): phiên active chưa enqueue BullMQ start → enqueue lại
  // (jobId dedup an toàn). Mỗi 2 phút — bù khi enqueue fail lúc tạo phiên.
  careSessionReconcileJob = cron.schedule(
    '*/2 * * * *',
    () => { void reconcileMissingSequenceStart(); },
    { timezone: TZ },
  );
  logger.info('[cron-scheduler] care-session reconcile registered (every 2 min ' + TZ + ')');

  logger.info('[cron-scheduler] started — birthday + event-log-cleanup + scheduled-trigger-activator + paused-until-sweeper + care-session-janitor + care-session-reconcile + ' + cronJobs.size + ' scheduled_cron triggers');
}

export function stopCronEventScheduler(): void {
  if (birthdayJob) { birthdayJob.stop(); birthdayJob = null; }
  if (eventLogCleanupJob) { eventLogCleanupJob.stop(); eventLogCleanupJob = null; }
  if (scheduledTriggerJob) { scheduledTriggerJob.stop(); scheduledTriggerJob = null; }
  if (pausedUntilSweepJob) { pausedUntilSweepJob.stop(); pausedUntilSweepJob = null; }
  if (careSessionJanitorJob) { careSessionJanitorJob.stop(); careSessionJanitorJob = null; }
  if (careSessionReconcileJob) { careSessionReconcileJob.stop(); careSessionReconcileJob = null; }
  for (const job of cronJobs.values()) job.stop();
  cronJobs.clear();
  isStarted = false;
}

// Called by trigger routes after CREATE/UPDATE/toggle so a new/edited trigger
// starts firing without a server restart.
export async function registerCronTrigger(triggerId: string): Promise<void> {
  // Always tear down existing job for this trigger first (idempotent re-register)
  unregisterCronTrigger(triggerId);

  const trigger = await prisma.automationTrigger.findUnique({
    where: { id: triggerId },
    select: { id: true, orgId: true, eventType: true, eventFilter: true, enabled: true, name: true },
  });
  if (!trigger) return;
  if (trigger.eventType !== 'scheduled_cron') return;
  if (!trigger.enabled) return;

  const cronExpr = extractCronExpression(trigger.eventFilter);
  if (!cronExpr) {
    logger.warn(`[cron-scheduler] trigger ${trigger.id} (${trigger.name}) has no cron expression in eventFilter`);
    return;
  }
  if (!cron.validate(cronExpr)) {
    logger.warn(`[cron-scheduler] trigger ${trigger.id} (${trigger.name}) has invalid cron expression: ${cronExpr}`);
    return;
  }

  const job = cron.schedule(cronExpr, () => {
    void fireScheduledCronEvent(trigger.id, trigger.orgId, cronExpr);
  }, { timezone: TZ });

  cronJobs.set(trigger.id, job);
  logger.info(`[cron-scheduler] registered trigger ${trigger.id} (${trigger.name}) with cron '${cronExpr}'`);
}

export function unregisterCronTrigger(triggerId: string): void {
  const existing = cronJobs.get(triggerId);
  if (existing) {
    existing.stop();
    cronJobs.delete(triggerId);
    logger.info(`[cron-scheduler] unregistered trigger ${triggerId}`);
  }
}

// ── Internal ───────────────────────────────────────────────────────────────

async function reloadAllScheduledCronTriggers(): Promise<void> {
  // Clear current jobs
  for (const job of cronJobs.values()) job.stop();
  cronJobs.clear();

  const triggers = await prisma.automationTrigger.findMany({
    where: { eventType: 'scheduled_cron', enabled: true },
    select: { id: true, orgId: true, eventFilter: true, name: true },
  });

  for (const t of triggers) {
    const cronExpr = extractCronExpression(t.eventFilter);
    if (!cronExpr || !cron.validate(cronExpr)) {
      logger.warn(`[cron-scheduler] skip trigger ${t.id} (${t.name}): invalid/missing cron expression`);
      continue;
    }
    const job = cron.schedule(cronExpr, () => {
      void fireScheduledCronEvent(t.id, t.orgId, cronExpr);
    }, { timezone: TZ });
    cronJobs.set(t.id, job);
  }
}

function extractCronExpression(eventFilter: unknown): string | null {
  if (!eventFilter || typeof eventFilter !== 'object') return null;
  const f = eventFilter as Record<string, unknown>;
  return typeof f.cron === 'string' ? f.cron : null;
}

async function fireScheduledCronEvent(triggerId: string, orgId: string, cronExpr: string): Promise<void> {
  try {
    // Re-check trigger is still enabled (defensive — could have been disabled
    // between schedule registration and fire time without unregister called)
    const stillEnabled = await prisma.automationTrigger.count({
      where: { id: triggerId, enabled: true },
    });
    if (stillEnabled === 0) {
      unregisterCronTrigger(triggerId);
      return;
    }

    automationEventBus.emit({
      type: 'scheduled_cron',
      orgId,
      occurredAt: new Date(),
      // no contactId — materializer resolves trigger.segmentSpec to get contacts
      payload: { triggerId, cron: cronExpr },
    });
    logger.info(`[cron-scheduler] fired scheduled_cron trigger ${triggerId} (cron='${cronExpr}')`);
  } catch (err) {
    logger.error(`[cron-scheduler] fireScheduledCronEvent error for ${triggerId}:`, err);
  }
}

async function fireBirthdayEvents(): Promise<void> {
  try {
    // Find all contacts whose birthDate month-day matches today (across all orgs).
    // birthDate is DATE type (no time), stored once at any year — we match MM-DD.
    // Postgres: extract(MONTH from birth_date) = X AND extract(DAY) = Y
    const now = new Date();
    // Build localized today for VN (UTC+7) since cron runs in TZ
    const vnNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
    const month = vnNow.getMonth() + 1; // 1-12
    const day = vnNow.getDate();         // 1-31

    const contacts = await prisma.$queryRaw<Array<{ id: string; org_id: string; birth_date: Date }>>`
      SELECT id, org_id, birth_date
      FROM contacts
      WHERE birth_date IS NOT NULL
        AND EXTRACT(MONTH FROM birth_date) = ${month}
        AND EXTRACT(DAY FROM birth_date) = ${day}
        AND merged_into IS NULL
    `;

    if (contacts.length === 0) {
      logger.info('[cron-scheduler] birthday tick — 0 contacts have birthday today');
      return;
    }

    logger.info(`[cron-scheduler] birthday tick — ${contacts.length} contacts have birthday today`);

    for (const c of contacts) {
      const ageGuess = vnNow.getFullYear() - new Date(c.birth_date).getFullYear();
      automationEventBus.emit({
        type: 'birthday',
        orgId: c.org_id,
        occurredAt: new Date(),
        contactId: c.id,
        payload: {
          birthDate: c.birth_date,
          age: ageGuess,
          month,
          day,
        },
      });
    }
  } catch (err) {
    logger.error('[cron-scheduler] fireBirthdayEvents error:', err);
  }
}

// ── BE T4 2026-05-30 — Scheduled trigger activator ─────────────────────────
//
// Mỗi 5 phút sweep AutomationTrigger state='draft' AND scheduledAt <= NOW().
// Mỗi trigger:
//   1. updateMany transactional WHERE id AND state='draft' → active + enabled=true
//      + scheduledAt=null. Nếu count=0 → đã có instance khác claim → skip.
//   2. Nếu eventType='friend_invite_to_list':
//        - precomputeAndSeedPool (idempotent — claim entries + seed queue)
//        - startNickWorker cho từng nick trong segmentSpec.nickIds (idempotent)
//        - logEvent('scheduled_activated') vào AutomationEventLog
//
// Server-side time (Prisma { lte: new Date() }) — KHÔNG cần stamp time từ agent.
//
// Single-instance race safety: updateMany với điều kiện state='draft' đảm bảo
// duy nhất 1 caller flip thành công; các caller khác count=0 và bỏ qua.
async function activateScheduledTriggers(): Promise<void> {
  try {
    const now = new Date();
    const dueTriggers = await prisma.automationTrigger.findMany({
      where: {
        state: 'draft',
        scheduledAt: { lte: now },
      },
      select: {
        id: true,
        orgId: true,
        name: true,
        eventType: true,
        segmentSpec: true,
        scheduledAt: true,
      },
    });

    if (dueTriggers.length === 0) return;

    logger.info(`[cron-scheduler] scheduled-trigger sweep — ${dueTriggers.length} due trigger(s)`);

    for (const trigger of dueTriggers) {
      // Transactional claim: chỉ flip nếu vẫn còn state='draft' tại thời điểm update.
      const claim = await prisma.automationTrigger.updateMany({
        where: { id: trigger.id, state: 'draft' },
        data: { state: 'active', enabled: true, scheduledAt: null },
      });
      if (claim.count === 0) {
        // Đã có instance khác (multi-pod) hoặc user manual activate/cancel kịp lúc.
        continue;
      }

      logger.info(
        `[cron-scheduler] activated trigger ${trigger.id} (${trigger.name}, ` +
          `eventType=${trigger.eventType}, scheduledAt=${trigger.scheduledAt?.toISOString()})`,
      );

      // eventType-specific bootstrap.
      if (trigger.eventType === 'friend_invite_to_list') {
        const spec = trigger.segmentSpec;
        if (!isFriendInviteSegmentSpec(spec)) {
          logger.warn(
            `[cron-scheduler] trigger ${trigger.id} activated but segmentSpec invalid — skip pool seed`,
          );
          continue;
        }
        try {
          // Idempotent — re-run trên entries đã claim chỉ refresh queue_status.
          await precomputeAndSeedPool({
            triggerId: trigger.id,
            orgId: trigger.orgId,
            spec,
          });
        } catch (err) {
          logger.error(
            `[cron-scheduler] precomputeAndSeedPool failed for trigger=${trigger.id}:`,
            err,
          );
        }

        // Spawn nick workers (fire-and-forget — idempotent).
        for (const nickId of spec.nickIds) {
          void startNickWorker(nickId, trigger.orgId).catch((err) =>
            logger.error(
              `[cron-scheduler] startNickWorker failed nick=${nickId} trigger=${trigger.id}:`,
              err,
            ),
          );
        }

        // Append-only event log (fire-and-forget).
        void logEvent({
          orgId: trigger.orgId,
          triggerId: trigger.id,
          eventType: 'scheduled_activated',
          summary: `Mục tiêu "${trigger.name}" đã được kích hoạt tự động theo lịch hẹn`,
          metadata: {
            scheduledAt: trigger.scheduledAt?.toISOString() ?? null,
            activatedAt: now.toISOString(),
            nickCount: spec.nickIds.length,
          },
        });
      }
    }
  } catch (err) {
    logger.error('[cron-scheduler] activateScheduledTriggers error:', err);
  }
}

// ── Test helper — fire birthday once manually (admin) ──────────────────────
export async function fireBirthdayNowForTesting(): Promise<{ count: number }> {
  const before = cronJobs.size; // just to mark we're "running"
  await fireBirthdayEvents();
  return { count: before };
}

// Test helper — fire scheduled-trigger sweep once manually (admin / smoke test).
export async function activateScheduledTriggersNowForTesting(): Promise<void> {
  await activateScheduledTriggers();
}

// ── P2 Wave 4 2026-06-03 — Paused-until sweeper ────────────────────────────
//
// Mỗi 1 phút sweep AutomationTrigger state='paused' AND pausedUntil <= NOW().
// Mỗi trigger:
//   1. updateMany transactional WHERE id AND state='paused' AND pausedUntil <= NOW()
//      → active + pausedUntil=null. count=0 → đã có instance khác claim/manual resume.
//   2. Nếu eventType='friend_invite_to_list': spawn nick workers (idempotent).
//   3. logEvent('auto_resumed') append-only.
//
// pausedUntil=NULL ⇒ pause vô hạn (legacy "Dừng vĩnh viễn") — KHÔNG bao giờ qualify
// vì WHERE pausedUntil <= NOW() loại NULL out.
async function resumePausedTriggers(): Promise<void> {
  try {
    const now = new Date();
    const dueTriggers = await prisma.automationTrigger.findMany({
      where: {
        state: 'paused',
        pausedUntil: { lte: now },
      },
      select: {
        id: true,
        orgId: true,
        name: true,
        eventType: true,
        segmentSpec: true,
        pausedUntil: true,
      },
    });

    if (dueTriggers.length === 0) return;

    logger.info(`[cron-scheduler] paused-until sweep — ${dueTriggers.length} due trigger(s)`);

    for (const trigger of dueTriggers) {
      // Transactional claim: chỉ flip nếu vẫn paused + TTL đến hạn (chống manual resume race).
      const claim = await prisma.automationTrigger.updateMany({
        where: { id: trigger.id, state: 'paused', pausedUntil: { lte: now } },
        data: { state: 'active', pausedUntil: null },
      });
      if (claim.count === 0) continue;

      logger.info(
        `[cron-scheduler] auto-resumed trigger ${trigger.id} (${trigger.name}, ` +
          `eventType=${trigger.eventType}, pausedUntil=${trigger.pausedUntil?.toISOString()})`,
      );

      // eventType-specific resume.
      if (trigger.eventType === 'friend_invite_to_list') {
        const spec = trigger.segmentSpec;
        if (isFriendInviteSegmentSpec(spec)) {
          for (const nickId of spec.nickIds) {
            void startNickWorker(nickId, trigger.orgId).catch((err) =>
              logger.error(
                `[cron-scheduler] startNickWorker failed nick=${nickId} trigger=${trigger.id}:`,
                err,
              ),
            );
          }
        }

        void logEvent({
          orgId: trigger.orgId,
          triggerId: trigger.id,
          eventType: 'auto_resumed',
          summary: `Mục tiêu "${trigger.name}" đã tự động tiếp tục sau khi hết thời gian tạm dừng`,
          metadata: {
            pausedUntil: trigger.pausedUntil?.toISOString() ?? null,
            resumedAt: now.toISOString(),
          },
        });
      }
    }
  } catch (err) {
    logger.error('[cron-scheduler] resumePausedTriggers error:', err);
  }
}

// Test helper — fire paused-until sweep once manually (admin / smoke test).
export async function resumePausedTriggersNowForTesting(): Promise<void> {
  await resumePausedTriggers();
}
