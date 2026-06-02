// Phase Friend Invite Queue 2026-05-28 — Per-nick setInterval worker lifecycle.
//
// Architecture (per anh chốt + spike verified):
//   - 1 worker per active ZaloAccount
//   - Each worker: setInterval với delay 20-40 phút random (TEST mode 1 phút)
//   - Each worker: pg_try_advisory_lock cho multi-instance safety
//   - Each iteration: claim 1 entry → dispatch Zalo SDK (Phase 1 → 2 → 3)
//
// Lifecycle hooks (gọi từ engine/index.ts):
//   - On server boot: spawn workers cho mọi ZaloAccount status=connected
//   - On nick.connected event: startNickWorker(nickId)
//   - On nick.disconnected event: stopNickWorker(nickId)
//   - On graceful shutdown: stopAllWorkers()
//
// Crash safety: advisory lock auto-released khi DB connection close
//   (spike #3 verified). Multi-instance setup: instance B sees lock taken
//   by instance A → 0 worker spawn → log warning.

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
import { resolveOrCreateContact } from '../../contacts/resolve-contact.js';
import { applyFriendTransition } from '../../zalo/friend-event-handler.js';
import { nickWorkerLockKey } from './fnv1a.js';
import { claimNextEntry, markEntrySent, releaseEntryFailed } from './pool-query.js';
import { logEvent } from './event-log-service.js';

// Test mode: 1 phút cố định (anh chốt cho test loop)
// Prod mode: 20-40 phút random (anh chốt design)
const TEST_MODE = process.env.FRIEND_INVITE_TEST_MODE === 'true';

interface WorkerState {
  timeoutId: NodeJS.Timeout | null;
  nickId: string;
  orgId: string;
  todayCount: number; // friend-request count today (from Outbox)
  isBusy: boolean; // prevent overlapping ticks
  stopped: boolean; // flag to halt self-scheduling loop
}

const nickWorkers = new Map<string, WorkerState>();

/**
 * Random delay 20-40 phút (prod) or 1 phút (test) trong millisecond.
 */
function getRandomDelayMs(): number {
  if (TEST_MODE) return 60_000; // 1 phút
  const minMs = 20 * 60_000;
  const maxMs = 40 * 60_000;
  return minMs + Math.random() * (maxMs - minMs);
}

/**
 * Recover today's friend-request count for this nick from Outbox table.
 * Uses Asia/Ho_Chi_Minh timezone for "today" boundary.
 */
async function recoverTodayCount(nickId: string): Promise<number> {
  const result = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt
    FROM friend_request_outbox o
    WHERE o.nick_id = ${nickId}
      AND o.send_status IN ('success', 'tentative')
      AND o.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')
  `;
  return Number(result[0]?.cnt ?? 0n);
}

/**
 * Working hours check — đọc từ Sequence.runtimeRules.allowedHourRange [start, end] (giờ VN).
 * Anh có thể chỉnh trong UI Sequence. Default 6h-22h nếu không có sequence hoặc rule.
 *
 * Fix 2026-05-30: hardcode 6-22 trước đây bỏ qua cấu hình UI của anh — gây bug worker
 * silent return khi anh chỉnh 23h trong Sequence nhưng vẫn bị chặn lúc 22:01.
 */
function getAllowedHourRange(runtimeRules: unknown): [number, number] {
  const rules = runtimeRules as { allowedHourRange?: [number, number] } | null | undefined;
  const range = rules?.allowedHourRange;
  if (Array.isArray(range) && range.length === 2 && typeof range[0] === 'number' && typeof range[1] === 'number') {
    return [range[0], range[1]];
  }
  return [6, 22]; // default conservative
}

function isWithinWorkingHours(allowedRange: [number, number] = [6, 22]): boolean {
  // Asia/Ho_Chi_Minh = UTC+7
  const now = new Date();
  const vnHour = (now.getUTCHours() + 7) % 24;
  // Fix 2026-05-30 23:08 — vnHour <= end (inclusive) thay vì <: anh chỉnh 23h
  // trong UI nghĩa là "tới hết 23h59", không phải block ngay khi đồng hồ sang 23:00.
  return vnHour >= allowedRange[0] && vnHour <= allowedRange[1];
}

/**
 * Spawn nick worker: acquire advisory lock + recover state + setInterval.
 * Idempotent: nếu worker đã exist, no-op.
 */
export async function startNickWorker(nickId: string, orgId: string): Promise<void> {
  if (nickWorkers.has(nickId)) {
    logger.debug(`[nick-worker] worker for ${nickId} already running, skip`);
    return;
  }

  // Acquire Postgres advisory lock (spike #3 verified auto-release on disconnect).
  const lockKey = nickWorkerLockKey(nickId);
  const lockResult = await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
    SELECT pg_try_advisory_lock(${lockKey})
  `;
  if (!lockResult[0]?.pg_try_advisory_lock) {
    logger.warn(
      `[nick-worker] advisory lock NOT acquired for nick=${nickId} (lockKey=${lockKey.toString()}). Another instance owns this nick. Skip spawn.`,
    );
    return;
  }

  // Recover state from DB
  const todayCount = await recoverTodayCount(nickId);

  const state: WorkerState = {
    timeoutId: null,
    nickId,
    orgId,
    todayCount,
    isBusy: false,
    stopped: false,
  };
  nickWorkers.set(nickId, state);

  // 2026-05-29 jitter fix — replace setInterval (constant delay locked at
  // spawn time) with self-scheduling setTimeout so every tick re-rolls the
  // 20-40 phút random window. Prevents predictable cadence per nick.
  const scheduleNext = (): void => {
    if (state.stopped) return;
    const next = getRandomDelayMs();
    state.timeoutId = setTimeout(() => {
      void runTick(nickId)
        .catch((err) => logger.error(`[nick-worker] tick error for nick=${nickId}:`, err))
        .finally(() => scheduleNext());
    }, next);
  };
  scheduleNext();

  logger.info(
    `[nick-worker] spawned nick=${nickId} todayCount=${todayCount} ${TEST_MODE ? '(TEST mode 1min)' : '(prod 20-40min jittered)'}`,
  );

  // Immediate first tick (after small jitter 1-5s) — don't wait full delay on spawn.
  // This lets anh see entries flow immediately when activating trigger.
  setTimeout(() => {
    void runTick(nickId).catch((err) =>
      logger.error(`[nick-worker] initial tick error for nick=${nickId}:`, err),
    );
  }, 1000 + Math.random() * 4000);
}

/**
 * Stop nick worker: clearInterval + release advisory lock.
 */
export async function stopNickWorker(nickId: string): Promise<void> {
  const worker = nickWorkers.get(nickId);
  if (!worker) return;

  worker.stopped = true;
  if (worker.timeoutId) clearTimeout(worker.timeoutId);
  nickWorkers.delete(nickId);

  const lockKey = nickWorkerLockKey(nickId);
  try {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockKey})`;
  } catch (err) {
    // Lock release best-effort. Connection drop auto-releases anyway.
    logger.warn(`[nick-worker] pg_advisory_unlock failed for nick=${nickId}:`, err);
  }

  logger.info(`[nick-worker] stopped nick=${nickId}`);
}

/**
 * Stop all workers (graceful shutdown).
 */
export async function stopAllNickWorkers(): Promise<void> {
  const nickIds = Array.from(nickWorkers.keys());
  for (const nickId of nickIds) {
    await stopNickWorker(nickId);
  }
  logger.info(`[nick-worker] stopped all ${nickIds.length} workers`);
}

/**
 * Get worker state (for dashboard query).
 */
export function getNickWorkerState(nickId: string): {
  isRunning: boolean;
  todayCount: number;
  isBusy: boolean;
} | null {
  const w = nickWorkers.get(nickId);
  if (!w) return null;
  return { isRunning: true, todayCount: w.todayCount, isBusy: w.isBusy };
}

/**
 * Resolve Contact.id để gắn FriendRequestOutbox + AutomationTask.
 *
 * Wave 1.5-B: delegate to canonical helper resolveOrCreateContact.
 * Helper xử lý 6-tier lookup theo rule anh chốt (UID không khớp, chỉ globalId + phone).
 * Spec: ~/.gstack/projects/zalocrm/EVO-THANH-private-hs-design-friend-invite-flow-review-20260529.md
 *
 * `enrichment` (optional) = data Zalo SDK trả về sau findUser thành công.
 * Helper sẽ dùng zaloUidInNick + zaloName để Friend reverse-lookup + stub naming.
 */
async function resolveContactIdForEntry(
  entry: { id: string; contactId: string | null; phoneE164: string | null; phoneRaw: string; nameRaw: string | null },
  orgId: string,
  enrichment?: { nickId: string; zaloUid: string; zaloName?: string | null; avatarUrl?: string | null; gender?: 'female' | 'male' | null } | null,
): Promise<string> {
  if (entry.contactId) return entry.contactId;

  const result = await resolveOrCreateContact({
    orgId,
    zaloAccountId: enrichment?.nickId ?? null,
    zaloUidInNick: enrichment?.zaloUid ?? null,
    phone: entry.phoneE164 ?? entry.phoneRaw,
    fallbackFullName: enrichment?.zaloName?.trim() || entry.nameRaw?.trim() || null,
    fallbackAvatarUrl: enrichment?.avatarUrl ?? null,
    gender: enrichment?.gender ?? null,
  });

  await prisma.customerListEntry.update({
    where: { id: entry.id },
    data: { contactId: result.id },
  });

  if (result.created) {
    logger.info(`[nick-worker] new stub Contact ${result.id} for entry ${entry.id} via ${result.matchedVia}`);
  } else {
    logger.info(`[nick-worker] resolved Contact ${result.id} for entry ${entry.id} via ${result.matchedVia}`);
  }
  return result.id;
}

/**
 * 1 tick: check gates → claim entry → 3-phase dispatch.
 */
async function runTick(nickId: string): Promise<void> {
  const worker = nickWorkers.get(nickId);
  if (!worker) return;
  if (worker.isBusy) return; // skip if previous tick still running

  // Gate 1: working hours — đọc UNION allowedHourRange từ các Sequence của active
  // triggers dùng nick này. Mở rộng nhất (min start, max end) để 1 nick phục vụ
  // nhiều Sequence cấu hình giờ khác nhau (vd anh chỉnh 23h cho 1 Sequence test).
  const activeRules = await prisma.automationSequence.findMany({
    where: {
      triggers: {
        some: {
          // Fix 2026-05-30 22:55 — bỏ filter state='active' để áp dụng giờ làm việc
          // cho cả outbox của trigger đã completed (workflow vẫn cần welcome + bám đuổi).
          eventType: 'friend_invite_to_list',
          segmentSpec: { path: ['nickIds'], array_contains: nickId },
        },
      },
    },
    select: { runtimeRules: true },
  }).catch(() => [] as Array<{ runtimeRules: unknown }>);
  let unionStart = 24, unionEnd = 0;
  for (const seq of activeRules) {
    const [s, e] = getAllowedHourRange(seq.runtimeRules);
    if (s < unionStart) unionStart = s;
    if (e > unionEnd) unionEnd = e;
  }
  const effectiveRange: [number, number] = activeRules.length > 0 ? [unionStart, unionEnd] : [6, 22];
  if (!isWithinWorkingHours(effectiveRange)) {
    logger.debug(`[nick-worker] ${nickId} skip tick: outside working hours ${effectiveRange[0]}-${effectiveRange[1]}h VN`);
    return;
  }

  // Gate 2: daily cap (friend-request)
  const nick = await prisma.zaloAccount.findUnique({
    where: { id: nickId },
    select: { dailyFriendAddCap: true, status: true, displayName: true },
  });
  if (!nick) {
    logger.warn(`[nick-worker] ${nickId} not found, stopping worker`);
    await stopNickWorker(nickId);
    return;
  }
  if (nick.status !== 'connected') {
    logger.debug(`[nick-worker] ${nickId} status=${nick.status}, skip tick`);
    return;
  }
  if (worker.todayCount >= nick.dailyFriendAddCap) {
    logger.debug(
      `[nick-worker] ${nickId} hit daily cap ${worker.todayCount}/${nick.dailyFriendAddCap}, skip tick`,
    );
    return;
  }

  worker.isBusy = true;
  try {
    // Phase 1: CLAIM
    const entry = await claimNextEntry(nickId, worker.orgId);
    if (!entry) {
      // Pool empty for this nick — that's OK, next tick will retry
      return;
    }
    if (!entry.phoneE164) {
      // Should never happen (skip rule pre-filtered) but defensive
      await releaseEntryFailed({ entryId: entry.id, nickId, reason: 'no phone_e164' });
      return;
    }

    logger.info(
      `[nick-worker] ${nickId} claimed entry=${entry.id} phone=${entry.phoneE164} row=${entry.rowIndex} trigger=${entry.triggerId}`,
    );

    // Load trigger for greeting template + successor sequence (snapshot at dispatch time)
    const trigger = await prisma.automationTrigger.findUnique({
      where: { id: entry.triggerId },
      select: { greetingTemplate: true, successorSequenceId: true, segmentSpec: true },
    });
    if (!trigger) {
      await releaseEntryFailed({ entryId: entry.id, nickId, reason: 'trigger not found' });
      return;
    }

    // Load sale user fullName for {sale} variable (last word VN convention)
    const ownerUser = await prisma.user.findFirst({
      where: { zaloAccounts: { some: { id: nickId } } },
      select: { fullName: true },
    });
    const saleName = (ownerUser?.fullName ?? 'em').trim().split(/\s+/).pop() ?? 'em';

    // Phase 2: ZALO HTTP (NO DB tx, 30s timeout enforced by zaloOps)
    let zaloLeadgenId = '';
    let isTentative = false;
    let zaloName = entry.nameRaw ?? 'bạn';
    let zaloGender: 'female' | 'male' | undefined;

    // Hoist enrichment scope outside try — both success + "already friend" catch
    // path need uid for Friend reverse-lookup in resolveContactIdForEntry.
    let resolvedUid = '';
    let resolvedDisplayName: string | null = null;
    let resolvedAvatarUrl: string | null = null;

    try {
      // 2.1: Find UID by phone (resolves UID + name + gender)
      const found = (await zaloOps.findUser(nickId, entry.phoneE164)) as
        | { uid?: string; displayName?: string; zaloName?: string; gender?: unknown; avatar?: string }
        | null
        | undefined;
      if (!found || !found.uid) {
        // KH không có Zalo — mark hasZalo=false + skip (Lead Pool no-Zalo flow handles later)
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: { queueStatus: 'skipped_status', hasZalo: false },
        });
        logger.info(`[nick-worker] ${nickId} entry=${entry.id} skipped: no Zalo profile for phone`);
        return;
      }
      resolvedUid = found.uid;
      // Extract gender + name + avatar from Zalo profile
      const profile = found as Record<string, unknown>;
      const rawGender = profile.gender;
      if (rawGender === 'female' || rawGender === 0 || rawGender === '0') zaloGender = 'female';
      else if (rawGender === 'male' || rawGender === 1 || rawGender === '1') zaloGender = 'male';
      const profileName = (profile.displayName as string | undefined) ?? (profile.zaloName as string | undefined);
      resolvedDisplayName = profileName?.trim() || null;
      resolvedAvatarUrl = (profile.avatar as string | undefined)?.trim() || null;
      if (profileName) zaloName = profileName.trim().split(/\s+/).pop() ?? zaloName;

      // 2.2: Render greeting template (per memory reference_greeting_template_vars)
      const genderRendered =
        zaloGender === 'female' ? 'Chị' : zaloGender === 'male' ? 'Anh' : 'Anh Chị';
      const greeting = (trigger.greetingTemplate ?? 'Chào {gender} {name}, em là {sale}.')
        .replaceAll('{gender}', genderRendered)
        .replaceAll('{name}', zaloName)
        .replaceAll('{sale}', saleName);

      // 2.3: Send friend request
      const sendResult = await zaloOps.sendFriendRequest(nickId, greeting, resolvedUid);
      // sendResult format từ zca-js — pick leadgen id if available
      const sr = sendResult as Record<string, unknown> | undefined;
      zaloLeadgenId = String(sr?.reqId ?? sr?.requestId ?? sr?.id ?? '');

      // Persist Zalo enrichment on entry (for later UI)
      await prisma.customerListEntry.update({
        where: { id: entry.id },
        data: {
          hasZalo: true,
          zaloUid: resolvedUid,
          zaloName: profileName ?? entry.nameRaw,
          resolvedByNickId: nickId,
        },
      });
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg = err?.message ?? String(err);

      // Detect "already friend" — KH đã là bạn của nick này. Coi như success
      // (no friend request needed) → mark processed + insert Outbox for sequence.
      if (msg.includes('đã là bạn') || msg.includes('already friend') || code === 'ALREADY_FRIEND') {
        logger.info(`[nick-worker] ${nickId} entry=${entry.id} already friend → mark processed`);
        // B2 fix: persist enrichment for "already friend" path too (was previously skipped)
        if (resolvedUid) {
          await prisma.customerListEntry.update({
            where: { id: entry.id },
            data: {
              hasZalo: true,
              zaloUid: resolvedUid,
              zaloName: resolvedDisplayName ?? entry.nameRaw,
              resolvedByNickId: nickId,
            },
          });
        }
        const contactId = await resolveContactIdForEntry(entry, worker.orgId, resolvedUid ? {
          nickId,
          zaloUid: resolvedUid,
          zaloName: resolvedDisplayName,
          avatarUrl: resolvedAvatarUrl,
          gender: zaloGender ?? null,
        } : null);
        // Wave 1.5-B: upsert Friend row (nick, contact, uid) — send-message gate
        // requires this row even khi "already friend" path detected.
        if (resolvedUid) {
          try {
            await applyFriendTransition({
              orgId: worker.orgId,
              zaloAccountId: nickId,
              contactId,
              zaloUidInNick: resolvedUid,
              newFriendshipStatus: 'accepted',
              source: 'sync', // no becameFriendAt — Zalo SDK chỉ nói "đã là bạn", không trả ngày
            });
          } catch (err) {
            logger.warn(`[nick-worker] applyFriendTransition failed entry=${entry.id}:`, err);
          }
        }
        await markEntrySent({
          entryId: entry.id,
          triggerId: entry.triggerId,
          nickId,
          contactId,
          successorSequenceId: trigger.successorSequenceId,
          sequenceSnapshot: null,
          zaloLeadgenId: 'already_friend',
          isTentative: false,
          kind: 'FRIEND_REQUEST',
        });
        worker.todayCount++;
        // Wave 3 Event Log — log "already friend" path để anh thấy trong tab Log sự kiện.
        // Fix 2026-05-30: trước đây path này silent, anh tưởng worker không chạy.
        {
          const cd = resolvedDisplayName?.trim() || entry.nameRaw?.trim() || entry.phoneE164 || 'KH';
          const nd = nick.displayName?.trim() || nickId.slice(0, 8);
          void logEvent({
            orgId: worker.orgId,
            triggerId: entry.triggerId,
            contactId,
            nickId,
            eventType: 'friend_already',
            eventPriority: 'info',
            summary: `${cd} đã là bạn với nick ${nd} — bỏ qua bước kết bạn, chuyển sang bám đuổi (row #${entry.rowIndex})`,
            metadata: { rowIndex: entry.rowIndex, phoneE164: entry.phoneE164 },
          });
        }
        return;
      }

      // Distinguish RATE_LIMITED (retry) vs hard error (release pool)
      if (code === 'RATE_LIMITED' || code === 'NOT_CONNECTED' || msg.includes('timeout')) {
        // Soft fail — release pool, nick có thể retry sau, KHÔNG append failedNickIds
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: {
            queueStatus: 'queued_for_pickup',
            claimedByNickId: null,
            lockedAt: null,
          },
        });
        logger.warn(
          `[nick-worker] ${nickId} entry=${entry.id} soft fail (${code || 'timeout'}): ${msg}`,
        );
      } else {
        // Hard fail — append failedNickIds
        await releaseEntryFailed({
          entryId: entry.id,
          nickId,
          reason: `${code} ${msg}`.slice(0, 200),
        });
        logger.warn(`[nick-worker] ${nickId} entry=${entry.id} hard fail: ${code} ${msg}`);
      }
      return;
    }

    // Phase 3: RESULT — Success path
    const contactId = await resolveContactIdForEntry(entry, worker.orgId, resolvedUid ? {
      nickId,
      zaloUid: resolvedUid,
      zaloName: resolvedDisplayName,
      avatarUrl: resolvedAvatarUrl,
          gender: zaloGender ?? null,
    } : null);
    // Wave 1.5-B: upsert Friend row với pending_sent status (KH chưa accept,
    // nhưng sequence cần row này để biết friendship state khi check gate).
    if (resolvedUid) {
      try {
        await applyFriendTransition({
          orgId: worker.orgId,
          zaloAccountId: nickId,
          contactId,
          zaloUidInNick: resolvedUid,
          newFriendshipStatus: 'pending_sent',
          source: 'event',
        });
      } catch (err) {
        logger.warn(`[nick-worker] applyFriendTransition failed entry=${entry.id}:`, err);
      }
    }
    await markEntrySent({
      entryId: entry.id,
      triggerId: entry.triggerId,
      nickId,
      contactId,
      successorSequenceId: trigger.successorSequenceId,
      sequenceSnapshot: null, // drainer re-fetches sequence at materialize time
      zaloLeadgenId,
      isTentative,
      kind: 'FRIEND_REQUEST',
    });

    // Update worker state
    worker.todayCount++;

    // Update ZaloAccount.lastFriendReqSentAt for cross-campaign throttle gate
    await prisma.zaloAccount.update({
      where: { id: nickId },
      data: { lastFriendReqSentAt: new Date() },
    });

    logger.info(
      `[nick-worker] ${nickId} entry=${entry.id} sent OK leadgen=${zaloLeadgenId} todayCount=${worker.todayCount}/${nick.dailyFriendAddCap}`,
    );

    // Wave 3 Event Log — friend_sent event cho Mục tiêu timeline.
    // Fire-and-forget: KHÔNG await, KHÔNG throw.
    const contactDisplayForLog =
      resolvedDisplayName?.trim() || entry.nameRaw?.trim() || entry.phoneE164 || 'KH';
    const nickDisplayForLog = nick.displayName?.trim() || nickId.slice(0, 8);
    void logEvent({
      orgId: worker.orgId,
      triggerId: entry.triggerId,
      contactId,
      nickId,
      eventType: 'friend_sent',
      eventPriority: 'info',
      summary: `Nick ${nickDisplayForLog} gửi lời kết bạn tới ${contactDisplayForLog} (row #${entry.rowIndex})`,
      metadata: {
        rowIndex: entry.rowIndex,
        zaloLeadgenId,
        isTentative,
        phoneE164: entry.phoneE164,
      },
    });
  } finally {
    worker.isBusy = false;
  }
}

/**
 * Bootstrap: spawn workers cho mọi connected ZaloAccount có entry trong pool.
 * Called once from app.ts on server start.
 */
export async function bootstrapFriendInviteWorkers(): Promise<void> {
  // Find nicks that are connected AND có entry trong pool (queue active)
  const nicks = await prisma.zaloAccount.findMany({
    where: { status: 'connected' },
    select: { id: true, orgId: true, displayName: true },
  });

  if (nicks.length === 0) {
    logger.info('[nick-worker] bootstrap: no connected nicks');
    return;
  }

  // Only spawn workers cho nicks có entries pending
  const nicksWithPending = await prisma.$queryRaw<Array<{ nick_id: string }>>`
    SELECT DISTINCT (segment_spec->'nickIds')::jsonb->>0 AS nick_id
    FROM automation_triggers
    WHERE event_type = 'friend_invite_to_list'
      AND state = 'active'
      AND segment_spec IS NOT NULL
  `;
  // Simpler approach: spawn worker for all nicks tied to active friend_invite_to_list triggers
  const activeNickIds = new Set<string>();
  const activeTriggers = await prisma.automationTrigger.findMany({
    where: { eventType: 'friend_invite_to_list', state: 'active' },
    select: { segmentSpec: true },
  });
  for (const t of activeTriggers) {
    const spec = t.segmentSpec as { nickIds?: string[] } | null;
    if (spec?.nickIds) {
      for (const nid of spec.nickIds) activeNickIds.add(nid);
    }
  }

  let spawned = 0;
  for (const nick of nicks) {
    if (!activeNickIds.has(nick.id)) continue;
    await startNickWorker(nick.id, nick.orgId);
    spawned++;
  }

  logger.info(`[nick-worker] bootstrap done: spawned ${spawned}/${nicks.length} workers`);
}
