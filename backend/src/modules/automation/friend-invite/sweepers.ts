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

import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { materializeSequenceForContact } from '../engine/campaign-materializer.js';
import { getSequenceStepQueue } from '../queues/queue-registry.js';
import { logEvent } from './event-log-service.js';
import { withTenant, runSystemQuery } from '../../../shared/tenant/tenant-context.js';

// #3 2026-06-06 (Anh chốt): các NGƯỠNG vận hành (kẹt mấy phút, cứu mấy lần, timeout
// mấy giờ, reset nick offline mấy giờ) đọc từ "Cài đặt kỹ thuật" cấp org thay vì
// hardcode. Single-org deploy → đọc org đầu tiên mỗi lần sweep (query rất nhẹ, có
// thể cache nếu cần). Fallback = default cũ khi chưa có settings / DB lỗi.
interface TechThresholds {
  stuckMinutes: number;
  stuckMaxRecovery: number;
  campaignTimeoutHours: number;
  nickOfflineResetHours: number;
}
async function getTechThresholds(): Promise<TechThresholds> {
  try {
    // Phase 1a 2026-06-08 — đọc cấu hình org đầu tiên (single-org deploy) ở
    // chế độ system: query này không gắn org cụ thể, dùng làm tham số kỹ thuật.
    const org = await runSystemQuery(() =>
      prisma.organization.findFirst({
        select: {
          autoStuckThresholdMinutes: true,
          autoStuckMaxRecovery: true,
          autoCampaignTimeoutHours: true,
          autoNickOfflineResetHours: true,
        },
      }),
    );
    return {
      stuckMinutes: org?.autoStuckThresholdMinutes || 5,
      stuckMaxRecovery: org?.autoStuckMaxRecovery || 10,
      campaignTimeoutHours: org?.autoCampaignTimeoutHours || 24,
      nickOfflineResetHours: org?.autoNickOfflineResetHours || 24,
    };
  } catch {
    return { stuckMinutes: 5, stuckMaxRecovery: 10, campaignTimeoutHours: 24, nickOfflineResetHours: 24 };
  }
}

let stuckSweeperInterval: NodeJS.Timeout | null = null;
let triggerSweeperInterval: NodeJS.Timeout | null = null;
let exhaustedSweeperInterval: NodeJS.Timeout | null = null;
let drainerInterval: NodeJS.Timeout | null = null;
let campaignTimeoutSweeperInterval: NodeJS.Timeout | null = null;

/**
 * Stuck sweeper — release entries stuck >5min back to pool.
 */
async function runStuckSweeper(): Promise<void> {
  try {
    // #3 2026-06-06 — ngưỡng kẹt + số lần cứu đọc từ Cài đặt kỹ thuật (Anh chỉnh được).
    const { stuckMinutes, stuckMaxRecovery } = await getTechThresholds();
    // ── Sprint v3 (2026-06-03) — Sửa 6.5 ──
    // Anh chốt: stuck do nick chết → release entry NHƯNG KHÔNG tăng counter
    // (vì lỗi không do SĐT mà do nick chết, không nên flip failed_stuck oan).
    // Increment chỉ khi nick còn connected — nghĩa là SĐT thực sự stuck do
    // lỗi worker/network chứ không phải nick chết tự nhiên.
    // #2 2026-06-06 — hàng đợi ở bảng nối trigger_queue_entries (q). EXISTS join
    // zalo_accounts đổi sang q.claimed_by_nick_id (cột giờ ở bảng nối).
    // Phase 1a 2026-06-08 — bulk maintenance UPDATE quét toàn org (không gắn
    // org cụ thể) → chạy ở chế độ system.
    const result = await runSystemQuery(() => prisma.$executeRaw`
      UPDATE trigger_queue_entries q
      SET queue_status = 'queued_for_pickup',
          claimed_by_nick_id = NULL,
          locked_at = NULL,
          updated_at = NOW(),
          stuck_recovery_count = CASE
            WHEN q.claimed_by_nick_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM zalo_accounts za
              WHERE za.id = q.claimed_by_nick_id
                AND za.status = 'connected'
            ) THEN q.stuck_recovery_count + 1
            ELSE q.stuck_recovery_count
          END
      WHERE q.queue_status = 'processing'
        AND q.locked_at < NOW() - make_interval(mins => ${stuckMinutes}::int)
        AND q.stuck_recovery_count < ${stuckMaxRecovery}::int
    `);
    if (result > 0) {
      logger.info(`[stuck-sweeper] released ${result} stuck entries back to pool`);
    }

    // Mark entries that hit max recoveries as failed_stuck
    const failedStuck = await runSystemQuery(() => prisma.$executeRaw`
      UPDATE trigger_queue_entries q
      SET queue_status = 'failed_stuck', updated_at = NOW()
      WHERE q.queue_status = 'processing'
        AND q.locked_at < NOW() - make_interval(mins => ${stuckMinutes}::int)
        AND q.stuck_recovery_count >= ${stuckMaxRecovery}::int
    `);
    if (failedStuck > 0) {
      logger.warn(`[stuck-sweeper] ${failedStuck} entries marked failed_stuck after 10 recoveries`);
    }
  } catch (err) {
    logger.error('[stuck-sweeper] error:', err);
  }
}

/**
 * Trigger completion sweeper — flip state='completed' khi:
 *   1) Pool friend-request empty (all entries processed/skipped/failed)
 *   2) AND all outbox WELCOME_PROBE rows đã materialize sequence (hoặc fail vĩnh viễn)
 *   3) AND all automation_campaigns của trigger đã state='completed' (sequence steps hết)
 *
 * Fix #6 v2 (2026-06-02): version 1 chỉ check tới enroll (sequenceMaterializedAt SET) →
 * trigger flip 'completed' NGAY khi enqueue jobs vào BullMQ delayed, dù step 1/2/3 chưa
 * fire. Sale thấy "Hoàn tất" trong khi sequence còn 60p delay chờ step 1.
 *
 * Fix v2: thêm condition #3 — campaign.state phải 'completed' (sequence-step-worker flip
 * sau khi xử lý step cuối cùng). Trigger chỉ thực sự "hoàn tất" khi cả friend-invite +
 * welcome + toàn bộ sequence steps xong.
 *
 * Edge case: trigger không có successor_sequence (friend-only, no bám đuổi) → campaign
 * không tồn tại → condition #3 trivially true (NOT EXISTS pending campaign).
 */
async function runTriggerCompletionSweeper(): Promise<void> {
  try {
    // Phase 1a 2026-06-08 — bulk maintenance UPDATE quét toàn org → system.
    const result = await runSystemQuery(() => prisma.$executeRaw`
      UPDATE automation_triggers
      SET state = 'completed', updated_at = NOW()
      WHERE state = 'active'
        AND event_type = 'friend_invite_to_list'
        AND id IN (
          -- #2 2026-06-06 — đếm hàng đợi từ bảng nối (q) theo từng trigger. Đây CHÍNH LÀ
          -- điểm sửa bug song song: trigger chỉ "hoàn tất" khi hàng đợi CỦA RIÊNG NÓ cạn,
          -- không bị ảnh hưởng bởi Mục tiêu khác dùng chung tệp.
          SELECT t.id FROM automation_triggers t
          LEFT JOIN trigger_queue_entries q ON q.trigger_id = t.id
          WHERE t.state = 'active'
            AND t.event_type = 'friend_invite_to_list'
          GROUP BY t.id
          HAVING COUNT(q.id) > 0
            AND COUNT(*) FILTER (WHERE q.queue_status IN ('queued_for_pickup', 'processing')) = 0
        )
        AND NOT EXISTS (
          -- Còn outbox WELCOME_PROBE chưa enroll sequence (chưa fail vĩnh viễn)
          SELECT 1 FROM friend_request_outbox o
          WHERE o.trigger_id = automation_triggers.id
            AND o.kind = 'WELCOME_PROBE'
            AND o.sequence_materialized_at IS NULL
            AND o.attempt_count < 5
            AND o.successor_sequence_id IS NOT NULL
        )
        AND NOT EXISTS (
          -- Fix v2 (2026-06-02): còn automation_campaigns đang 'active' của trigger này
          -- (sequence-step-worker chưa xử lý hết step cuối → chưa flip campaign.state='completed').
          SELECT 1 FROM automation_campaigns c
          WHERE c.trigger_id = automation_triggers.id
            AND c.state = 'active'
        )
    `);
    if (result > 0) {
      logger.info(`[trigger-sweeper] flipped ${result} triggers to state='completed' (pool empty + welcome enrolled + all sequence campaigns done)`);
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
    // #2 2026-06-06 — failedNickIds + queue ở bảng nối (q) theo từng trigger.
    // Phase 1a 2026-06-08 — bulk maintenance UPDATE quét toàn org → system.
    const result = await runSystemQuery(() => prisma.$executeRaw`
      UPDATE trigger_queue_entries q
      SET queue_status = 'failed_permanent', updated_at = NOW()
      FROM automation_triggers t
      WHERE q.trigger_id = t.id
        AND q.queue_status = 'queued_for_pickup'
        AND t.event_type = 'friend_invite_to_list'
        AND jsonb_array_length(q.failed_nick_ids) >= jsonb_array_length(t.segment_spec->'nickIds')
        AND jsonb_array_length(t.segment_spec->'nickIds') > 0
    `);
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
    // Fix #1 (2026-06-02): thêm DUPLICATE_SKIP — khi KH đã nhận welcome từ trigger trước
    // (cùng nick+contact), welcome-probe skip nhưng VẪN phải enroll sequence bám đuổi mới.
    // Không enroll = trigger mới chạy nhưng sequence không bao giờ tới step 1.
    // Phase 1a 2026-06-08 — pull outbox cross-org ở chế độ system; mỗi row xử lý
    // trong withTenant(trigger.orgId) sau khi tra được org.
    const rows = await runSystemQuery(() =>
      prisma.friendRequestOutbox.findMany({
        where: {
          kind: 'WELCOME_PROBE',
          welcomeOutcome: { in: ['SENT_STRANGER', 'SENT_FRIEND', 'DUPLICATE_SKIP'] },
          sequenceMaterializedAt: null,
          successorSequenceId: { not: null },
          attemptCount: { lt: 5 },
        },
        take: 50,
        orderBy: { createdAt: 'asc' },
      }),
    );

    if (rows.length === 0) return;

    let materialized = 0;
    for (const row of rows) {
      try {
        // Look up trigger to get orgId + ruleOverrides + 2 công tắc bám đuổi (#1).
        // Tra trigger ở chế độ system vì chưa biết org của row trước khi lookup.
        const trigger = await runSystemQuery(() =>
          prisma.automationTrigger.findUnique({
            where: { id: row.triggerId },
            select: {
              orgId: true,
              ruleOverrides: true,
              followUpStrangerEnabled: true,
              followUpFriendEnabled: true,
            },
          }),
        );
        if (!trigger) {
          logger.warn(`[outbox-drainer] trigger ${row.triggerId} not found for outbox row ${row.id}`);
          await runSystemQuery(() =>
            prisma.friendRequestOutbox.update({
              where: { id: row.id },
              data: {
                attemptCount: { increment: 1 },
                lastErrorMessage: 'trigger missing',
              },
            }),
          );
          continue;
        }

        // Toàn bộ xử lý org-scoped của row chạy trong tenant scope của trigger.orgId.
        const outcome = await withTenant(trigger.orgId, async () => {
          // ── #1 2026-06-06 (Anh chốt): chặn enroll bám đuổi theo 2 công tắc ──
          // Xác định KH hiện đã là bạn của nick chưa (quyết định công tắc nào áp dụng).
          // SENT_STRANGER = welcome gửi qua hộp người lạ ⇒ lúc đó CHƯA là bạn.
          // SENT_FRIEND = đã là bạn. DUPLICATE_SKIP = tra Friend thực tế để biết.
          let isFriendNow = row.welcomeOutcome === 'SENT_FRIEND';
          if (row.welcomeOutcome === 'DUPLICATE_SKIP') {
            const fr = await prisma.friend.findFirst({
              where: { zaloAccountId: row.nickId, contactId: row.contactId, friendshipStatus: 'accepted' },
              select: { id: true },
            });
            isFriendNow = !!fr;
          }
          // CT1 (chưa là bạn) tắt → KHÔNG bám đuổi qua hộp người lạ.
          // CT2 (đã là bạn) tắt → KHÔNG bám đuổi KH đã là bạn (chờ accept path lo nếu cần).
          const allowed = isFriendNow ? trigger.followUpFriendEnabled : trigger.followUpStrangerEnabled;
          if (!allowed) {
            // Đánh dấu đã xử lý (materialized) để drainer không quét lại mãi; KHÔNG enqueue sequence.
            await prisma.friendRequestOutbox.update({
              where: { id: row.id },
              data: {
                sequenceMaterializedAt: new Date(),
                lastErrorMessage: isFriendNow
                  ? 'followUpFriendEnabled=false — bỏ qua bám đuổi (KH đã là bạn)'
                  : 'followUpStrangerEnabled=false — bỏ qua bám đuổi (KH chưa kết bạn)',
              },
            });
            logger.info(
              `[outbox-drainer] skip enroll (công tắc tắt) trigger=${row.triggerId} contact=${row.contactId} isFriend=${isFriendNow}`,
            );
            return 'skip' as const;
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
            return 'skip' as const;
          }
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              sequenceMaterializedAt: new Date(),
            },
          });
          return 'materialized' as const;
        });

        if (outcome === 'materialized') materialized++;
      } catch (err: any) {
        logger.error(`[outbox-drainer] materialize failed for outbox row ${row.id}:`, err);
        await runSystemQuery(() =>
          prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              attemptCount: { increment: 1 },
              lastErrorMessage: (err?.message ?? String(err)).slice(0, 500),
            },
          }),
        );
      }
    }

    if (materialized > 0) {
      logger.info(`[outbox-drainer] materialized ${materialized}/${rows.length} sequence campaigns`);
    }

    // Alert on rows with attemptCount >= 5 — đếm cross-org (monitoring) → system.
    const stuck = await runSystemQuery(() =>
      prisma.friendRequestOutbox.count({
        where: {
          sequenceMaterializedAt: null,
          attemptCount: { gte: 5 },
        },
      }),
    );
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
    // ── Sprint v3 (2026-06-03) — Sửa 4.5 ──
    // Sau khi welcome-probe gate nick.status (Tuần 1.3), nick offline KHÔNG
    // còn rơi vào HARD_FAIL — đã chuyển sang AWAITING_NICK + nickHoldSince.
    // HARD_FAIL còn lại đúng nghĩa "KH thực sự lỗi cứng / friend record gone"
    // → vẫn retire để khỏi đa-poll vô hạn (Anh chốt câu 3 GIỮ NGUYÊN sau khi
    // em giải thích, không bỏ retire HARD_FAIL như em đề xuất sai ban đầu).
    // Phase 1a 2026-06-08 — bulk cleanup quét toàn org → system.
    const { count } = await runSystemQuery(() =>
      prisma.friendRequestOutbox.updateMany({
        where: {
          kind: 'WELCOME_PROBE',
          welcomeOutcome: { in: ['BLOCKED_STRANGER', 'HARD_FAIL'] },
          sequenceMaterializedAt: null,
        },
        data: {
          sequenceMaterializedAt: new Date(),
        },
      }),
    );
    if (count > 0) {
      logger.info(`[welcome-failed-cleanup] retired ${count} BLOCKED_STRANGER/HARD_FAIL rows from poll set`);
    }
  } catch (err) {
    logger.error('[welcome-failed-cleanup] error:', err);
  }
}

let welcomeFailedCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Campaign timeout sweeper — P2 2026-06-02.
 *
 * Vấn đề: AutomationCampaign.state='active' có thể kẹt vĩnh viễn khi:
 *   1) sequence-step-worker crash giữa khi xử lý step cuối (chưa kịp flip campaign
 *      sang 'completed' trong tryCompleteCampaign).
 *   2) Redis mất job (eviction policy sai, OOM, restart không persistent) → jobs
 *      delayed của step N+1 bốc hơi → không bao giờ có call nào kích flip state.
 *   3) Trigger event-hook hủy hết jobs (KH block/reject) nhưng quên flip campaign.
 *
 * Hệ quả: trigger sweeper (runTriggerCompletionSweeper) check NOT EXISTS active
 * campaign → false vĩnh viễn → trigger kẹt 'active' → UI hiện đang chạy trong
 * khi thực tế đã chết.
 *
 * Threshold: 12h. Lý do (đối thoại design 2026-06-02):
 *   - 6h quá ngắn: sequence dài 10 step × 1h delay = 10h vẫn còn legit.
 *   - 24h quá lâu: sale thấy "đang chạy" cả ngày dù chết, mất trust UI.
 *   - 12h compromise: cover sequence dài 10h + buffer 2h cho delay worker chậm,
 *     vẫn detect kịp trong nửa ngày.
 *
 * Double-check an toàn: trước khi flip, scan BullMQ delayed/waiting/active jobs
 * theo prefix `${triggerId}-` (buildSequenceStepJobId pattern). Nếu vẫn còn jobs
 * → KHÔNG flip (campaign vẫn alive, chỉ là DB updatedAt chưa refresh). Chỉ flip
 * khi zero jobs pending — đó là evidence chắc chắn Redis đã mất việc.
 *
 * Flow:
 *   1. SELECT campaigns WHERE state='active' AND updatedAt < NOW() - INTERVAL '12 hours'
 *      AND triggerId IS NOT NULL.
 *   2. Với mỗi campaign: scan BullMQ jobs prefix=`${triggerId}-`. Nếu count > 0 → skip.
 *   3. UPDATE campaign SET state='timeout', completedAt=NOW().
 *   4. Log AutomationEventLog eventType='campaign_timeout' priority='urgent'.
 */
async function runCampaignTimeoutSweeper(): Promise<void> {
  try {
    // #3 2026-06-06 — ngưỡng timeout campaign đọc từ Cài đặt kỹ thuật (Anh chỉnh được).
    // ── Sprint v3 (2026-06-03) — Sửa 5.7: đổi 12h → 24h (giờ là default) ──
    // Anh chốt sticky+hold 24h: sequence dài nhất ~10h + buffer 14h cho nick
    // hồi. Quá ngưỡng vẫn không advance = nick chết hẳn → timeout campaign.
    // runStickyNickHoldSweeper (mới, mục 4.8) chạy 5 phút quét nick_hold_since,
    // sẽ reset KH về queue ở mốc ngưỡng trước khi sweeper này kích campaign timeout.
    // Sweeper campaign-timeout còn giữ làm safety net cho campaign orphan.
    const { campaignTimeoutHours } = await getTechThresholds();
    // FIX C 2026-06-08 — BỎ điều kiện `triggerId NOT NULL`. Campaign mồ côi (trigger đã xoá
    // → onDelete:SetNull set triggerId=null) trước đây kẹt state='active' vĩnh viễn → an toàn
    // flip 'timeout'. Nhánh mồ côi xử lý riêng trong vòng lặp (không scan BullMQ).
    // Phase 1a: quét cross-org ở chế độ system; flip + event-log từng campaign trong withTenant.
    const stale = await runSystemQuery(() =>
      prisma.automationCampaign.findMany({
        where: {
          state: { in: ['active', 'on_hold'] },
          updatedAt: { lt: new Date(Date.now() - campaignTimeoutHours * 60 * 60_000) },
        },
        select: {
          id: true,
          orgId: true,
          triggerId: true,
          sequenceId: true,
          updatedAt: true,
        },
        take: 200,
      }),
    );

    if (stale.length === 0) return;

    // Step 2: scan BullMQ pending jobs ONE TIME — getJobs across all triggers,
    // sau đó group theo triggerId prefix để check per-campaign.
    let pendingJobs: Awaited<ReturnType<ReturnType<typeof getSequenceStepQueue>['getJobs']>> = [];
    try {
      const queue = getSequenceStepQueue();
      pendingJobs = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 10_000);
    } catch (err) {
      logger.warn(
        `[campaign-timeout-sweeper] BullMQ scan failed, skip this tick (sẽ retry tick sau): ${(err as Error).message}`,
      );
      return; // Defensive: nếu Redis down, KHÔNG flip oan (có thể jobs vẫn tồn tại sau khi Redis hồi).
    }

    let flipped = 0;
    for (const c of stale) {
      // FIX C 2026-06-08 — Campaign mồ côi (triggerId=null, trigger đã xoá): không thể
      // scan BullMQ theo prefix triggerId. Trigger đã xoá → không nguồn job mới + jobId cũ
      // không khớp gì → flip thẳng 'timeout', BỎ QUA double-check job và BỎ QUA logEvent
      // (logEvent yêu cầu triggerId hợp lệ — xem event-log-service.ts). Nhánh trigger thật
      // giữ nguyên double-check như cũ.
      if (c.triggerId) {
        const prefix = `${c.triggerId}-`;
        const hasPendingJob = pendingJobs.some((j) => j.id && j.id.startsWith(prefix));
        if (hasPendingJob) {
          logger.debug(
            `[campaign-timeout-sweeper] skip campaign=${c.id} trigger=${c.triggerId} — vẫn còn job pending trong BullMQ`,
          );
          continue;
        }
      }

      // Step 3: atomic flip — đảm bảo vẫn 'active' hoặc 'on_hold' (tránh race với tryCompleteCampaign).
      // Sprint v3 (2026-06-03): on_hold cũng eligible — campaign sticky hold quá 24h thì timeout.
      const updated = await withTenant(c.orgId, () =>
        prisma.automationCampaign.updateMany({
          where: { id: c.id, state: { in: ['active', 'on_hold'] } },
          data: { state: 'timeout', completedAt: new Date() },
        }),
      );
      if (updated.count === 0) continue; // race lost, ai đó đã flip rồi

      flipped++;
      const staleHours = Math.round(
        (Date.now() - c.updatedAt.getTime()) / 3_600_000,
      );
      logger.warn(
        `[campaign-timeout-sweeper] FLIPPED campaign=${c.id} trigger=${c.triggerId ?? 'orphan'} ` +
          `sequence=${c.sequenceId ?? 'null'} state='timeout' (stale ${staleHours}h, zero BullMQ jobs)`,
      );

      // Step 4: alert event log (fire-and-forget). Chỉ log khi có triggerId hợp lệ —
      // campaign mồ côi (FIX C) không có Mục tiêu để gắn event nên bỏ qua, chỉ flip state.
      // Phase 1a: bọc withTenant(c.orgId).
      if (c.triggerId) {
        void withTenant(c.orgId, () => logEvent({
          orgId: c.orgId,
          triggerId: c.triggerId!,
          eventType: 'campaign_timeout',
          eventPriority: 'urgent',
          summary: `Campaign ${c.id} bị timeout sau ${staleHours}h không advance (worker crash hoặc Redis mất việc).`,
          metadata: {
            campaignId: c.id,
            sequenceId: c.sequenceId,
            staleHours,
            flippedAt: new Date().toISOString(),
          },
        }));
      }
    }

    if (flipped > 0) {
      logger.warn(
        `[campaign-timeout-sweeper] flipped ${flipped}/${stale.length} stale campaigns to state='timeout'`,
      );
    }
  } catch (err) {
    logger.error('[campaign-timeout-sweeper] error:', err);
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * Sticky Nick Hold Sweeper — Sprint v3 (2026-06-03)
 * ════════════════════════════════════════════════════════════════════════
 * Quét entries có nick_hold_since > 24h. Reset KH về queue cho nick khác
 * làm lại từ đầu: friend + welcome + sequence.
 *
 * Anh chốt:
 *   Câu 1: append failedNickIds (Option A) — tránh nick chết tự pick lại KH
 *   Câu 2: reset luôn todayCount=0 cho nick cũ (em document, không enforce ở
 *          sweeper này — nick worker tự đọc lại khi reconnect)
 *   Câu 4: TÁCH SCOPE — Row 2.2 + 6.9 đợt sau (Anh sau đổi ý làm cùng sprint)
 *   Notification mốc T+23h (Anh edit từ 24h xuống 23h) — gửi qua kênh
 *   internal contact để Anh + chủ nick có 1h xử lý trước khi reset 24h.
 *
 * Flow per entry:
 *   1. SELECT entry WHERE nick_hold_since IS NOT NULL AND
 *      nick_hold_since < NOW() - INTERVAL '24 hours' AND
 *      queue_status IN ('processed', 'processing').
 *   2. TX (per entry):
 *      a. Snapshot outbox cũ vào automation_event_log (audit trail).
 *      b. DELETE outbox FRIEND_REQUEST + WELCOME_PROBE (theo contact+trigger).
 *      c. UPDATE entry SET queue_status='queued_for_pickup',
 *         claimed_by_nick_id=NULL, locked_at=NULL,
 *         failed_nick_ids = failed_nick_ids || jsonb_build_array(nick_cũ),
 *         restart_cycle += 1, last_reset_reason='nick_offline_24h',
 *         nick_hold_since=NULL.
 *      d. UPDATE automation_campaigns SET state='timeout', completedAt=NOW()
 *         (cho campaign có cùng triggerId+sequenceId+contact đó).
 *      e. Log AutomationEventLog eventType='nick_hold_reset' priority='urgent'.
 *   3. Pool tự nhiên cho nick khác claim lại từ đầu.
 */
async function runStickyNickHoldSweeper(): Promise<void> {
  try {
    // #3 2026-06-06 — ngưỡng reset nick offline đọc từ Cài đặt kỹ thuật (Anh chỉnh được).
    const { nickOfflineResetHours } = await getTechThresholds();
    const cutoff = new Date(Date.now() - nickOfflineResetHours * 60 * 60_000);
    // #2 2026-06-06 — quét bảng nối (per-trigger). rowIndex/phoneE164 lấy qua relation entry.
    // Phase 1a 2026-06-08 — quét cross-org ở chế độ system; reset từng entry trong
    // withTenant(orgId) bên dưới (orgId tra theo trigger của entry).
    const staleRows = await runSystemQuery(() =>
      prisma.triggerQueueEntry.findMany({
        where: {
          nickHoldSince: { not: null, lt: cutoff },
          queueStatus: { in: ['processed', 'processing'] },
        },
        select: {
          customerListEntryId: true,
          customerListId: true,
          triggerId: true,
          contactId: true,
          claimedByNickId: true,
          nickHoldSince: true,
          restartCycle: true,
          failedNickIds: true,
          entry: { select: { rowIndex: true, phoneE164: true } },
        },
        take: 50, // tránh long tx
      }),
    );

    if (staleRows.length === 0) return;

    // Map về shape cũ để phần dưới dùng e.id / e.rowIndex / e.phoneE164 như trước.
    const stale = staleRows.map((q) => ({
      id: q.customerListEntryId,
      customerListId: q.customerListId,
      triggerId: q.triggerId,
      contactId: q.contactId,
      claimedByNickId: q.claimedByNickId,
      nickHoldSince: q.nickHoldSince,
      restartCycle: q.restartCycle,
      failedNickIds: q.failedNickIds,
      rowIndex: q.entry?.rowIndex ?? 0,
      phoneE164: q.entry?.phoneE164 ?? null,
    }));

    let resetCount = 0;
    for (const e of stale) {
      const oldNickId = e.claimedByNickId;
      const failedArr: string[] = Array.isArray(e.failedNickIds)
        ? (e.failedNickIds as string[])
        : [];
      // Append old nick to failed list — không cho nick chết tự pick lại KH cũ.
      const newFailedNickIds = oldNickId && !failedArr.includes(oldNickId)
        ? [...failedArr, oldNickId]
        : failedArr;

      try {
        // Phase 1a 2026-06-08 — tra orgId của entry (system) để mở tenant scope
        // cho transaction reset bên dưới.
        const entryOrg = e.triggerId
          ? await runSystemQuery(() =>
              prisma.automationTrigger.findUnique({
                where: { id: e.triggerId! },
                select: { orgId: true },
              }),
            )
          : null;
        await withTenant(entryOrg?.orgId ?? '', () => tenantTransaction(async (tx) => {
          // Lookup org_id từ trigger (cần cho event log)
          const trigger = e.triggerId
            ? await tx.automationTrigger.findUnique({
                where: { id: e.triggerId },
                select: { orgId: true },
              })
            : null;

          // a. Snapshot outbox vào event log
          if (e.triggerId && e.contactId && trigger?.orgId) {
            const oldOutbox = await tx.friendRequestOutbox.findMany({
              where: {
                triggerId: e.triggerId,
                contactId: e.contactId,
              },
              select: {
                id: true,
                kind: true,
                nickId: true,
                sendStatus: true,
                welcomeOutcome: true,
                welcomeSentAt: true,
                attemptRound: true,
                createdAt: true,
              },
            });
            // b. DELETE outbox cũ (restart cycle xoá vết để welcome lần mới chạy được)
            if (oldOutbox.length > 0) {
              await tx.friendRequestOutbox.deleteMany({
                where: {
                  triggerId: e.triggerId,
                  contactId: e.contactId,
                },
              });
            }
            // Audit snapshot
            await tx.automationEventLog.create({
              data: {
                orgId: trigger.orgId,
                triggerId: e.triggerId,
                contactId: e.contactId,
                nickId: oldNickId,
                eventType: 'nick_hold_reset',
                eventPriority: 'urgent',
                summary: `⏰ KH #${e.rowIndex} (${e.phoneE164 ?? 'no phone'}) reset về queue sau ${Math.round((Date.now() - (e.nickHoldSince?.getTime() ?? Date.now())) / 3_600_000)}h chờ nick offline. Vòng ${(e.restartCycle ?? 0) + 1}.`,
                metadata: {
                  entryId: e.id,
                  oldNickId,
                  oldFailedNickIds: failedArr,
                  newFailedNickIds,
                  restartCycle: (e.restartCycle ?? 0) + 1,
                  outboxSnapshot: oldOutbox,
                  reason: 'nick_offline_24h',
                },
              },
            });
          }

          // c. Reset hàng đợi về queue — #2: bảng nối per-trigger.
          await tx.triggerQueueEntry.update({
            where: { triggerId_customerListEntryId: { triggerId: e.triggerId, customerListEntryId: e.id } },
            data: {
              queueStatus: 'queued_for_pickup',
              claimedByNickId: null,
              lockedAt: null,
              failedNickIds: newFailedNickIds,
              restartCycle: { increment: 1 },
              lastResetReason: 'nick_offline_24h',
              nickHoldSince: null,
            },
          });

          // d. Flip campaign về timeout (sweeper campaign-timeout sẽ xử lý alert)
          if (e.triggerId) {
            await tx.automationCampaign.updateMany({
              where: {
                triggerId: e.triggerId,
                state: { in: ['active', 'on_hold'] },
              },
              data: {
                state: 'timeout',
                completedAt: new Date(),
                nickFirstOfflineAt: null,
              },
            });
          }
        }));
        resetCount++;
        logger.warn(
          `[sticky-hold-sweeper] reset entry=${e.id} oldNick=${oldNickId} restartCycle=${(e.restartCycle ?? 0) + 1} (nick offline >24h)`,
        );
      } catch (txErr) {
        logger.error(
          `[sticky-hold-sweeper] reset entry=${e.id} failed:`,
          txErr,
        );
      }
    }

    if (resetCount > 0) {
      logger.warn(
        `[sticky-hold-sweeper] reset ${resetCount}/${stale.length} entries về queue sau 24h nick offline`,
      );
    }
  } catch (err) {
    logger.error('[sticky-hold-sweeper] error:', err);
  }
}

let stickyHoldSweeperInterval: NodeJS.Timeout | null = null;
let remindSweeperInterval: NodeJS.Timeout | null = null;

/**
 * I12 2026-06-04 — Tin 3: Nhắc KH đồng ý kết bạn sau N ngày.
 * Quét outbox FRIEND_REQUEST đã gửi > trigger.remindDelayDays mà KH CHƯA accept
 * + CHƯA gửi nhắc + trigger bật enableRemind + có remindTemplate. Gửi qua hộp người lạ.
 *
 * SKIP (Anh chốt): nếu KH đã đồng ý (Friend accepted qua nick này) → bỏ qua, không nhắc.
 * Idempotent: đã có event 'remind_sent' cho (trigger, contact) → bỏ qua (gửi 1 lần).
 */
async function runRemindSweeper(): Promise<void> {
  try {
    // Các trigger friend_invite đang active, bật nhắc, có template.
    // Phase 1a 2026-06-08 — trigger list cross-org ở chế độ system; xử lý từng
    // trigger trong withTenant(t.orgId) bên dưới.
    const triggers = await runSystemQuery(() =>
      prisma.automationTrigger.findMany({
        where: {
          eventType: 'friend_invite_to_list',
          state: 'active',
          enableRemind: true,
          remindTemplate: { not: null },
        },
        select: { id: true, orgId: true, remindTemplate: true, remindDelayDays: true },
        take: 50,
      }),
    );
    if (triggers.length === 0) return;

    let sent = 0;
    for (const t of triggers) {
      await withTenant(t.orgId, async () => {
      const cutoff = new Date(Date.now() - (t.remindDelayDays || 3) * 24 * 3600_000);
      // Outbox FRIEND_REQUEST đã gửi quá hạn, lấy nick + contact + uid.
      const candidates = await prisma.friendRequestOutbox.findMany({
        where: {
          triggerId: t.id,
          kind: 'FRIEND_REQUEST',
          sendStatus: { in: ['success', 'tentative'] },
          createdAt: { lt: cutoff },
        },
        select: { contactId: true, nickId: true, customerListEntryId: true },
        take: 100,
      });
      for (const c of candidates) {
        if (!c.contactId || !c.nickId) continue;
        // SKIP nếu KH đã accepted qua nick này (Tin 2 đã/đang lo) — Anh chốt.
        const accepted = await prisma.friend.findFirst({
          where: { contactId: c.contactId, zaloAccountId: c.nickId, friendshipStatus: 'accepted' },
          select: { id: true },
        });
        if (accepted) continue;
        // Idempotent: đã nhắc rồi → bỏ qua.
        const already = await prisma.automationEventLog.findFirst({
          where: { triggerId: t.id, contactId: c.contactId, eventType: 'remind_sent' },
          select: { id: true },
        });
        if (already) continue;
        // FIX 2026-06-04 (Anh hỏi): resolve UID THẬT từ findUser-qua-SĐT đã lưu.
        // 2 nguồn: Friend.zaloUidInNick (nick-worker lưu sau findUser, 4776 rows) ưu tiên,
        // fallback CustomerListEntry.zaloUid (enrich lúc import). KHÔNG dùng zaloLeadgenId
        // (đó là mã reqId của friend-request, KHÔNG phải UID — không gửi tin được).
        let uid = '';
        const fr = await prisma.friend.findFirst({
          where: { contactId: c.contactId, zaloAccountId: c.nickId },
          select: { zaloUidInNick: true },
        });
        uid = fr?.zaloUidInNick ?? '';
        if (!uid && c.customerListEntryId) {
          const entry = await prisma.customerListEntry.findUnique({
            where: { id: c.customerListEntryId },
            select: { zaloUid: true },
          });
          uid = entry?.zaloUid ?? '';
        }
        if (!uid) continue;
        try {
          const { sendStrangerFollowUp } = await import('../queues/event-hooks.js');
          await sendStrangerFollowUp({
            orgId: t.orgId,
            triggerId: t.id,
            contactId: c.contactId,
            nickId: c.nickId,
            uid,
            template: t.remindTemplate!,
            eventType: 'remind_sent',
          });
          sent++;
        } catch (err) {
          logger.warn(`[remind-sweeper] send failed contact=${c.contactId}: ${(err as Error).message}`);
        }
      }
      });
    }
    if (sent > 0) logger.info(`[remind-sweeper] sent ${sent} Tin 3 nhắc đồng ý KB`);
  } catch (err) {
    logger.error('[remind-sweeper] error:', err);
  }
}

/**
 * Start all sweepers (Sprint v3 — 7 sweeper + remind Tin 3).
 */
export async function startFriendInviteSweepers(): Promise<void> {
  if (
    stuckSweeperInterval ||
    triggerSweeperInterval ||
    exhaustedSweeperInterval ||
    drainerInterval ||
    welcomeFailedCleanupInterval ||
    campaignTimeoutSweeperInterval ||
    stickyHoldSweeperInterval ||
    remindSweeperInterval
  ) {
    logger.warn('[friend-invite] sweepers already running, skip start');
    return;
  }

  // #3 2026-06-06 (Anh chốt): nhịp quét sweeper đọc từ "Cài đặt kỹ thuật" cấp org
  // thay vì hardcode. Single-org deploy → đọc org đầu tiên. Fallback = default cũ
  // nếu chưa có settings / DB lỗi. (Đổi nhịp cần restart container để áp dụng — đây
  // là tham số kỹ thuật ít đổi, không cần hot-reload.)
  let stuckSec = 60, drainerSec = 30, remindMin = 30;
  try {
    const org = await prisma.organization.findFirst({
      select: {
        autoStuckSweepSeconds: true,
        autoDrainerSweepSeconds: true,
        autoRemindSweepMinutes: true,
      },
    });
    if (org) {
      stuckSec = org.autoStuckSweepSeconds || 60;
      drainerSec = org.autoDrainerSweepSeconds || 30;
      remindMin = org.autoRemindSweepMinutes || 30;
    }
  } catch (err) {
    logger.warn('[friend-invite] đọc Cài đặt kỹ thuật thất bại, dùng nhịp mặc định:', err);
  }

  stuckSweeperInterval = setInterval(() => void runStuckSweeper(), stuckSec * 1000);
  triggerSweeperInterval = setInterval(() => void runTriggerCompletionSweeper(), 60_000);
  exhaustedSweeperInterval = setInterval(() => void runExhaustedNicksSweeper(), 60_000);
  drainerInterval = setInterval(() => void runOutboxDrainer(), drainerSec * 1000);
  welcomeFailedCleanupInterval = setInterval(() => void runWelcomeFailedCleanup(), 60_000);
  // Sprint v3 2026-06-03 — campaign timeout sweeper (5 min). Ngưỡng timeout đọc per-org
  // trong runCampaignTimeoutSweeper + BullMQ pending-job double-check trước flip.
  campaignTimeoutSweeperInterval = setInterval(
    () => void runCampaignTimeoutSweeper(),
    5 * 60_000,
  );
  // Sprint v3 2026-06-03 — sticky-hold sweeper (5 min). Ngưỡng reset nick offline
  // đọc per-org trong runStickyNickHoldSweeper.
  stickyHoldSweeperInterval = setInterval(
    () => void runStickyNickHoldSweeper(),
    5 * 60_000,
  );
  // I12 2026-06-04 — Tin 3 nhắc đồng ý KB. Nhịp quét đọc từ Cài đặt kỹ thuật.
  remindSweeperInterval = setInterval(() => void runRemindSweeper(), remindMin * 60_000);

  logger.info(
    `[friend-invite] sweepers started: stuck(${stuckSec}s) + trigger-complete(60s) + exhausted-nicks(60s) + outbox-drainer(${drainerSec}s) + welcome-failed-cleanup(60s) + campaign-timeout(5min) + sticky-hold(5min) + remind-Tin3(${remindMin}min)`,
  );

  // Initial run on start
  void runStuckSweeper();
  void runExhaustedNicksSweeper();
  void runTriggerCompletionSweeper();
  void runOutboxDrainer();
  void runWelcomeFailedCleanup();
  void runCampaignTimeoutSweeper();
  void runStickyNickHoldSweeper();
  void runRemindSweeper();
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
  if (campaignTimeoutSweeperInterval) clearInterval(campaignTimeoutSweeperInterval);
  if (stickyHoldSweeperInterval) clearInterval(stickyHoldSweeperInterval);
  if (remindSweeperInterval) clearInterval(remindSweeperInterval);
  stuckSweeperInterval = null;
  triggerSweeperInterval = null;
  exhaustedSweeperInterval = null;
  drainerInterval = null;
  welcomeFailedCleanupInterval = null;
  campaignTimeoutSweeperInterval = null;
  stickyHoldSweeperInterval = null;
  remindSweeperInterval = null;
  logger.info('[friend-invite] sweepers stopped');
}
