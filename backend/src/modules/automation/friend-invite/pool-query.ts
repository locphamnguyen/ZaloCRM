// Phase Friend Invite Queue 2026-05-28 — Pool claim query với SKIP LOCKED.
//
// Worker dispatch flow 3-phase (per spike memo):
//   Phase 1 CLAIM (short DB tx <50ms): UPDATE entry status=processing, claim
//   Phase 2 ZALO HTTP (NO DB tx, 30s hard timeout): findUser + sendFriendRequest
//   Phase 3 RESULT (short DB tx <50ms):
//     - Success: UPDATE entry='processed' + INSERT outbox sendStatus='success'
//                (post-execute hook trong markDoneAndAdvance handles outbox INSERT
//                khi dispatch qua AutomationTask path. Direct claim path INSERT here.)
//     - Fail: UPDATE entry='queued_for_pickup', append nickId vào failedNickIds
//     - Timeout: UPDATE entry='processed' + outbox sendStatus='tentative'
//
// Crash recovery: nếu worker crash giữa Phase 2 và Phase 3 → entry stuck status=processing
// → stuck sweeper after 5 phút release back to pool (documented duplicate-send risk).

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

export interface ClaimedEntry {
  id: string;
  contactId: string | null;
  phoneE164: string | null;
  phoneRaw: string;
  nameRaw: string | null;
  triggerId: string;
  zaloUid: string | null;
  rowIndex: number;
}

/**
 * Claim 1 entry từ pool cho nick này. Implements SKIP LOCKED to avoid race
 * across multiple nick workers within the same Node process.
 *
 * Returns null nếu pool empty for this nick (no entry pickable hiện tại).
 *
 * Filters:
 *   - queueStatus = 'queued_for_pickup'
 *   - trigger belongs to active list-based triggers anh chọn nickId này
 *   - NOT (failedNickIds @> [nickId])  — nick này chưa fail entry
 *   - jsonb_array_length(failedNickIds) < trigger.nickIds.length  — vẫn còn nick eligible
 *     (entries hết nick eligible đã được markFailedPermanent ở releaseEntryFailed)
 *
 * Order: rowIndex ASC, then trigger creation time ASC (FIFO).
 */
export async function claimNextEntry(nickId: string, orgId: string): Promise<ClaimedEntry | null> {
  // Single atomic UPDATE...RETURNING with SKIP LOCKED subquery.
  // Subquery checks trigger.nickIds (in segmentSpec JSONB) contains this nickId.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      contact_id: string | null;
      phone_e164: string | null;
      phone_raw: string;
      name_raw: string | null;
      trigger_id: string;
      zalo_uid: string | null;
      row_index: number;
    }>
  >`
    UPDATE customer_list_entries
    SET claimed_by_nick_id = ${nickId},
        locked_at = NOW(),
        queue_status = 'processing'
    WHERE id = (
      SELECT e.id
      FROM customer_list_entries e
      JOIN automation_triggers t ON t.id = e.trigger_id
      WHERE e.queue_status = 'queued_for_pickup'
        AND t.state = 'active'
        AND t.org_id = ${orgId}
        AND t.event_type = 'friend_invite_to_list'
        AND (t.segment_spec->'nickIds')::jsonb @> to_jsonb(${nickId}::text)
        AND NOT (e.failed_nick_ids @> to_jsonb(${nickId}::text))
        AND jsonb_array_length(e.failed_nick_ids) < jsonb_array_length(t.segment_spec->'nickIds')
      ORDER BY e.row_index ASC, t.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, contact_id, phone_e164, phone_raw, name_raw, trigger_id, zalo_uid, row_index
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    contactId: r.contact_id,
    phoneE164: r.phone_e164,
    phoneRaw: r.phone_raw,
    nameRaw: r.name_raw,
    triggerId: r.trigger_id,
    zaloUid: r.zalo_uid,
    rowIndex: r.row_index,
  };
}

/**
 * Phase 3 RESULT — Success: mark entry processed + INSERT outbox row atomically.
 * Outbox drainer cron will materialize sequence.
 */
export async function markEntrySent(input: {
  entryId: string;
  triggerId: string;
  nickId: string;
  contactId: string;
  successorSequenceId: string | null;
  sequenceSnapshot: unknown | null;
  zaloLeadgenId: string;
  isTentative: boolean;
  kind?: string;
}): Promise<void> {
  // Default kind = 'FRIEND_REQUEST' for Wave 1 friend invite flow.
  // Welcome-probe-worker enqueues a separate WELCOME_PROBE row AFTER friend accept
  // (or here, alongside, if explicitly requested). Defaulting to WELCOME_PROBE was a
  // Wave 2 regression that caused the welcome worker to send before the friend
  // request was accepted, and broke P2002 composite unique on retries.
  const kind = input.kind ?? 'FRIEND_REQUEST';
  await prisma.$transaction(async (tx) => {
    // Fix 2026-05-30 23:35 — re-test cùng KH trên trigger mới phải reset outbox cũ
    // (composite unique entry+kind chặn create row mới). Pattern: delete outbox của
    // trigger CŨ trước upsert nếu workflow của trigger mới. Idempotent: nếu cùng
    // triggerId thì upsert tiếp tục no-op như cũ.
    await tx.friendRequestOutbox.deleteMany({
      where: {
        customerListEntryId: input.entryId,
        triggerId: { not: input.triggerId },
      },
    });
    await tx.customerListEntry.update({
      where: { id: input.entryId },
      data: {
        queueStatus: 'processed',
        lockedAt: null,
        // processedAt is reused from enrichedAt? Keep enrichedAt for legacy;
        // Phase Friend Invite uses Outbox.createdAt as send timestamp.
      },
    });
    // Upsert (idempotent) on composite unique [customerListEntryId, kind].
    // P2002 was firing whenever a retry of an already-sent entry re-entered this
    // path (rare under normal flow, but happens after worker restart while an
    // entry was mid-tick). upsert lets the retry no-op safely.
    await tx.friendRequestOutbox.upsert({
      where: {
        customerListEntryId_kind: {
          customerListEntryId: input.entryId,
          kind,
        },
      },
      create: {
        customerListEntryId: input.entryId,
        triggerId: input.triggerId,
        nickId: input.nickId,
        contactId: input.contactId,
        successorSequenceId: input.successorSequenceId,
        sequenceVersionSnapshot: (input.sequenceSnapshot as object | undefined) ?? undefined,
        sendStatus: input.isTentative ? 'tentative' : 'success',
        zaloLeadgenId: input.zaloLeadgenId,
        kind,
        allowStrangerMessage: true,
      },
      update: {
        // Re-affirm send status on retry, but never clear sequence materialization
        // or welcome outcome fields — those belong to downstream workers.
        sendStatus: input.isTentative ? 'tentative' : 'success',
        zaloLeadgenId: input.zaloLeadgenId,
      },
    });

    // Wave 2: enqueue the WELCOME_PROBE row at the same time as the FRIEND_REQUEST
    // row, so welcome-probe-worker has a row to wait on. The probe worker honours
    // its own `welcome_delay_after_friend_req_sec` floor, so this is safe.
    if (kind === 'FRIEND_REQUEST') {
      await tx.friendRequestOutbox.upsert({
        where: {
          customerListEntryId_kind: {
            customerListEntryId: input.entryId,
            kind: 'WELCOME_PROBE',
          },
        },
        create: {
          customerListEntryId: input.entryId,
          triggerId: input.triggerId,
          nickId: input.nickId,
          contactId: input.contactId,
          successorSequenceId: input.successorSequenceId,
          sequenceVersionSnapshot: (input.sequenceSnapshot as object | undefined) ?? undefined,
          sendStatus: 'success',
          zaloLeadgenId: input.zaloLeadgenId,
          kind: 'WELCOME_PROBE',
          allowStrangerMessage: true,
        },
        update: {}, // no-op on retry — probe owns this row from here on
      });
    }
  });
}

/**
 * Phase 3 RESULT — Fail: release entry back to pool + append nickId to failedNickIds.
 * Next iteration nick khác sẽ pick.
 *
 * `failed_nick_ids = failed_nick_ids || to_jsonb(nick_id)` appends if not already present.
 * Idempotent: nếu cùng nick fail 2 lần (retry path), array vẫn unique.
 */
export async function releaseEntryFailed(input: {
  entryId: string;
  nickId: string;
  reason: string;
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE customer_list_entries
    SET queue_status = 'queued_for_pickup',
        claimed_by_nick_id = NULL,
        locked_at = NULL,
        failed_nick_ids = CASE
          WHEN failed_nick_ids @> to_jsonb(${input.nickId}::text)
            THEN failed_nick_ids
          ELSE failed_nick_ids || to_jsonb(${input.nickId}::text)
        END
    WHERE id = ${input.entryId}
  `;
  // After append, check if failedNickIds covers all trigger's nicks → mark failed_permanent.
  // Trigger's eligible nick count = segmentSpec.nickIds.length (config tại trigger create time).
  // Race-safe: re-read array + trigger spec (no Prisma relation enforced — query separately).
  const after = await prisma.customerListEntry.findUnique({
    where: { id: input.entryId },
    select: { failedNickIds: true, triggerId: true },
  });
  if (!after || !after.triggerId) return;
  const failedArr = Array.isArray(after.failedNickIds) ? (after.failedNickIds as string[]) : [];
  const trigger = await prisma.automationTrigger.findUnique({
    where: { id: after.triggerId },
    select: { segmentSpec: true },
  });
  const spec = trigger?.segmentSpec as { nickIds?: string[] } | null;
  const triggerNickCount = Array.isArray(spec?.nickIds) ? spec!.nickIds!.length : 5;
  if (failedArr.length >= triggerNickCount) {
    await prisma.customerListEntry.update({
      where: { id: input.entryId },
      data: { queueStatus: 'failed_permanent' },
    });
    logger.warn(
      `[friend-invite] entry ${input.entryId} marked failed_permanent — all ${triggerNickCount} trigger nicks failed (last reason: ${input.reason})`,
    );
  }
}
