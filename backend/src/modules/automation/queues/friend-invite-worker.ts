// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M2a — Friend Invite BullMQ Worker (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// Replaces legacy `nick-worker.ts` setInterval polling architecture.
// BullMQ Worker pull from queue `friend-invite` thay vì poll DB mỗi 20-40 phút.
//
// Job payload:
//   {
//     triggerId: string,
//     entryId: string,
//     nickId: string,
//     orgId: string,
//   }
//
// Pipeline (sẽ thêm full guards trong M2b — hour, quota, recency, multi-nick):
//   1. Load entry + verify state queued_for_pickup
//   2. Claim entry (pool-query.claimNextEntry pattern, single row)
//   3. Resolve contact qua phone → Zalo UID
//   4. Send friend-request (Zalo SDK)
//   5. Mark entry processed + INSERT outbox
//   6. On error: classifyError (T4A) → permanent vs transient
//
// Concurrency: 1 per nick (sequential, anh chốt). Multiple workers cho cùng
// nick = race condition (Zalo Anti-spam treat as DDoS). BullMQ Worker class
// concurrency: option mặc định 1 = đúng.
//
// Reuse:
//   - pool-query.markEntrySent / releaseEntryFailed
//   - applyFriendTransition (friend-event-handler)
//   - resolveOrCreateContact (contacts)
//
// Memory: project_friend_invite_test_config 2026-05-28 (test cap 300/day,
// delay 1 phút) — cap đọc từ ZaloAccount.dailyFriendAddCap (default 30, anh
// override per-nick trong /settings/channels/zalo).

import { Worker, type Job, type WorkerOptions } from 'bullmq';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getBullMQRedis } from './redis-connection.js';
import { QUEUE_NAMES, buildFriendInviteJobId } from './queue-registry.js';

export interface FriendInviteJobData {
  triggerId: string;
  entryId: string;
  nickId: string;
  orgId: string;
}

export interface FriendInviteResult {
  status: 'sent' | 'permanent_fail' | 'transient_fail' | 'skipped';
  reason?: string;
  outboxId?: string;
}

let workerInstance: Worker<FriendInviteJobData, FriendInviteResult> | null = null;

// ════════════════════════════════════════════════════════════════════════
// Job processor — single tick per job
// ════════════════════════════════════════════════════════════════════════
async function processJob(
  job: Job<FriendInviteJobData, FriendInviteResult>,
): Promise<FriendInviteResult> {
  const { triggerId, entryId, nickId } = job.data;
  const tag = `[friend-invite-worker job=${job.id}]`;

  logger.info(`${tag} processing entry=${entryId} nick=${nickId} trigger=${triggerId}`);

  // M2a: stub — verify pipeline framework works. Full Zalo SDK call + skip
  // rules check sẽ thêm trong M2b.

  // 1. Load entry để verify state
  const entry = await prisma.customerListEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      queueStatus: true,
      triggerId: true,
      claimedByNickId: true,
      phoneE164: true,
      phoneRaw: true,
      zaloUid: true,
      contactId: true,
    },
  });

  if (!entry) {
    logger.warn(`${tag} entry ${entryId} not found, skipping`);
    return { status: 'skipped', reason: 'entry_not_found' };
  }

  if (entry.queueStatus !== 'queued_for_pickup' && entry.queueStatus !== 'processing') {
    logger.warn(
      `${tag} entry ${entryId} state=${entry.queueStatus}, skipping (already processed?)`,
    );
    return { status: 'skipped', reason: `state_${entry.queueStatus}` };
  }

  if (entry.triggerId !== triggerId) {
    logger.warn(
      `${tag} entry ${entryId} triggerId mismatch (db=${entry.triggerId}, job=${triggerId}), skipping`,
    );
    return { status: 'skipped', reason: 'trigger_mismatch' };
  }

  // M2a stub: log dispatch intent + mark entry processed
  // M2b sẽ thêm: hour check, Lua quota, recency check, sendFriendRequest Zalo SDK.
  logger.info(
    `${tag} [M2a STUB] would dispatch sendFriendRequest(nick=${nickId}, phone=${entry.phoneE164 ?? entry.phoneRaw}, uid=${entry.zaloUid})`,
  );

  // Mark entry processed (placeholder để M2b thay bằng pool-query.markEntrySent)
  await prisma.customerListEntry.update({
    where: { id: entryId },
    data: {
      queueStatus: 'processed',
      lockedAt: null,
      claimedByNickId: nickId,
    },
  });

  return { status: 'sent', reason: 'm2a_stub' };
}

// ════════════════════════════════════════════════════════════════════════
// Worker lifecycle
// ════════════════════════════════════════════════════════════════════════
export function startFriendInviteWorker(opts?: Partial<WorkerOptions>): Worker {
  if (workerInstance) {
    logger.warn('[friend-invite-worker] already started');
    return workerInstance;
  }

  workerInstance = new Worker<FriendInviteJobData, FriendInviteResult>(
    QUEUE_NAMES.FRIEND_INVITE,
    processJob,
    {
      connection: getBullMQRedis(),
      // Concurrency 1 per nick — sequential. Future: multi-worker per nick = Zalo ban risk.
      concurrency: 1,
      // M2b sẽ add: per-nick rate limit qua Lua quota gate
      ...opts,
    },
  );

  workerInstance.on('completed', (job) => {
    logger.info(
      `[friend-invite-worker] completed job=${job.id} status=${job.returnvalue?.status}`,
    );
  });

  workerInstance.on('failed', (job, err) => {
    logger.error(
      `[friend-invite-worker] failed job=${job?.id} attempt=${job?.attemptsMade}/${job?.opts.attempts}: ${err.message}`,
    );
  });

  workerInstance.on('error', (err) => {
    logger.error(`[friend-invite-worker] error: ${err.message}`);
  });

  logger.info('[friend-invite-worker] started');
  return workerInstance;
}

export async function stopFriendInviteWorker(): Promise<void> {
  if (workerInstance) {
    logger.info('[friend-invite-worker] closing...');
    await workerInstance.close();
    workerInstance = null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Enqueue helper — gọi từ trigger-routes.ts khi trigger activate
// ════════════════════════════════════════════════════════════════════════
import { getFriendInviteQueue } from './queue-registry.js';

export async function enqueueFriendInvite(
  data: FriendInviteJobData,
  delay = 0,
): Promise<void> {
  const queue = getFriendInviteQueue();
  const jobId = buildFriendInviteJobId(data.triggerId, data.entryId);
  await queue.add('send-friend-request', data, {
    jobId,
    delay,
  });
  logger.info(
    `[friend-invite-worker] enqueued jobId=${jobId} (delay=${delay}ms)`,
  );
}
