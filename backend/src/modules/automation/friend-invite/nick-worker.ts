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

import type { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
import { resolveOrCreateContact } from '../../contacts/resolve-contact.js';
import { applyFriendTransition } from '../../zalo/friend-event-handler.js';
import { nickWorkerLockKey } from './fnv1a.js';
import { claimNextEntry, markEntrySent, releaseEntryFailed } from './pool-query.js';
import { logEvent } from './event-log-service.js';
import { checkMultiNickThreshold } from '../queues/worker-guards.js';
import { getBullMQRedis } from '../queues/redis-connection.js';

// 2026-06-03 Sprint v3 Tuần 3 Row 2.2: socket emit "claimed" event mỗi khi nick
// pick entry để Mục tiêu Detail dashboard surface UI "KH X → nick Y đang xử lý".
// Inject io từ app.ts:391 qua setNickWorkerIO(io). Org-scoped: io.to('org:${orgId}').
let ioRef: SocketIOServer | null = null;
export function setNickWorkerIO(io: SocketIOServer): void {
  ioRef = io;
}

// ── Phase 2 idempotency sentinel ─────────────────────────────────────────
// Stuck sweeper P1 (2026-06-02): worker crash BETWEEN Phase 2 sendFriendRequest
// success và Phase 3 markEntrySent → entry quay pool (sweeper revive sau 5 phút)
// → nick khác (hoặc cùng nick) claim → resend → KH nhận 2 lời mời.
//
// Fix: trước khi gọi sendFriendRequest, ghi sentinel Redis key chứa leadgenId.
// Lần sau retry, nếu sentinel còn fresh (<5 phút), skip send + reuse leadgenId
// để jump thẳng Phase 3. Sentinel TTL 1 ngày để guarantee không bao giờ resend
// trong cùng ngày dù worker restart nhiều lần.
//
// Key shape: fi:sent:<entryId>:<nickId>
// Value shape: JSON { sentAt: epochMs, leadgenId: string }
// TTL: 86400s (1 ngày)
// Freshness window: 5 phút — match stuck sweeper threshold. Quá window này thì
// coi như Zalo backend có thể đã expire request, được phép retry (Zalo idempotency
// bên họ tự enforce qua mã 222 "already friend").
const PHASE2_SENTINEL_TTL_SEC = 86_400;
const PHASE2_SENTINEL_FRESH_MS = 5 * 60_000;

function phase2SentinelKey(entryId: string, nickId: string): string {
  return `fi:sent:${entryId}:${nickId}`;
}

interface Phase2Sentinel {
  sentAt: number;
  leadgenId: string;
}

async function readPhase2Sentinel(
  entryId: string,
  nickId: string,
): Promise<Phase2Sentinel | null> {
  try {
    const raw = await getBullMQRedis().get(phase2SentinelKey(entryId, nickId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Phase2Sentinel;
    if (typeof parsed?.sentAt !== 'number') return null;
    return parsed;
  } catch (err) {
    logger.warn(`[nick-worker] readPhase2Sentinel failed entry=${entryId} nick=${nickId}:`, err);
    return null;
  }
}

async function writePhase2Sentinel(
  entryId: string,
  nickId: string,
  payload: Phase2Sentinel,
): Promise<void> {
  try {
    await getBullMQRedis().set(
      phase2SentinelKey(entryId, nickId),
      JSON.stringify(payload),
      'EX',
      PHASE2_SENTINEL_TTL_SEC,
    );
  } catch (err) {
    // Redis down → log but DON'T block send. Falling back to "no idempotency"
    // is strictly worse than ngày-nay behaviour, không tệ hơn.
    logger.warn(`[nick-worker] writePhase2Sentinel failed entry=${entryId} nick=${nickId}:`, err);
  }
}

// #3 2026-06-06 (Anh chốt): BỎ chế độ test/prod hardcode. Nhịp gửi lời mời giờ
// đọc từ cấu hình Mục tiêu (cột friend_req_interval_min/max_minutes) — Anh nhập
// trên UI. Muốn "test nhanh 1 phút" thì set min=max=1 ngay trên Mục tiêu, không
// còn phụ thuộc biến môi trường FRIEND_INVITE_TEST_MODE nữa.
// Fallback khi nick chưa gắn Mục tiêu nào (hiếm): 20-40 phút như default cũ.
const DEFAULT_INTERVAL_MIN_MS = 20 * 60_000;
const DEFAULT_INTERVAL_MAX_MS = 40 * 60_000;

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
 * Nhịp gửi (ms) giữa 2 lần gửi lời mời của 1 nick — random trong [min, max] phút
 * ĐỌC TỪ CẤU HÌNH Mục tiêu (Anh nhập trên UI), không còn hardcode.
 *
 * 1 nick có thể phục vụ nhiều Mục tiêu cấu hình nhịp khác nhau → lấy khoảng RỘNG
 * NHẤT (min của các min, max của các max) để không nick nào bị ép nhanh hơn mức
 * Mục tiêu cẩn trọng nhất cho phép. Không có Mục tiêu active → fallback 20-40 phút.
 */
async function getNextDelayMs(nickId: string): Promise<number> {
  let minMs = DEFAULT_INTERVAL_MIN_MS;
  let maxMs = DEFAULT_INTERVAL_MAX_MS;
  try {
    const rows = await prisma.$queryRaw<Array<{ min_min: number | null; max_max: number | null }>>`
      SELECT MIN(friend_req_interval_min_minutes) AS min_min,
             MAX(friend_req_interval_max_minutes) AS max_max
      FROM automation_triggers
      WHERE event_type = 'friend_invite_to_list'
        AND state = 'active'
        AND (segment_spec->'nickIds')::jsonb @> to_jsonb(${nickId}::text)
    `;
    const r = rows[0];
    if (r?.min_min != null && r?.max_max != null) {
      minMs = Math.max(0, Number(r.min_min)) * 60_000;
      maxMs = Math.max(Number(r.max_max), Number(r.min_min)) * 60_000;
    }
  } catch (err) {
    logger.warn(`[nick-worker] getNextDelayMs read config failed nick=${nickId}, dùng default 20-40m:`, err);
  }
  if (maxMs <= minMs) return minMs;
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

// #3 2026-06-06: bỏ getAllowedHourRange (đọc Sequence.runtimeRules) — Gate 1 giờ
// đọc thẳng cột send_hour_start/end của Mục tiêu (xem runTick).

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
    // Nhịp đọc từ cấu hình Mục tiêu mỗi lần lên lịch → Anh chỉnh nhịp trên UI là
    // áp dụng ngay từ lượt kế tiếp, không cần restart worker.
    void getNextDelayMs(nickId).then((next) => {
      if (state.stopped) return;
      state.timeoutId = setTimeout(() => {
        void runTick(nickId)
          .catch((err) => logger.error(`[nick-worker] tick error for nick=${nickId}:`, err))
          .finally(() => scheduleNext());
      }, next);
    });
  };
  scheduleNext();

  logger.info(
    `[nick-worker] spawned nick=${nickId} todayCount=${todayCount} (nhịp gửi đọc từ cấu hình Mục tiêu)`,
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
  stopNickRespawnSweeper(); // dừng sweeper trước để không respawn ngược trong lúc shutdown
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

  // Gate 1: working hours — #3 2026-06-06 (Anh chốt): ĐỌC TỪ CỘT send_hour_start/end
  // của chính Mục tiêu (Anh nhập trên wizard), thay vì Sequence.runtimeRules như cũ
  // (cột UI trước đây bị worker bỏ qua → ô giờ vô tác dụng). 1 nick phục vụ nhiều
  // Mục tiêu giờ khác nhau → lấy khoảng RỘNG NHẤT (min start, max end). Không có Mục
  // tiêu active nào → fallback 6-22h.
  const hourRows = await prisma.$queryRaw<Array<{ min_start: number | null; max_end: number | null }>>`
    SELECT MIN(send_hour_start) AS min_start, MAX(send_hour_end) AS max_end
    FROM automation_triggers
    WHERE event_type = 'friend_invite_to_list'
      AND state = 'active'
      AND (segment_spec->'nickIds')::jsonb @> to_jsonb(${nickId}::text)
  `.catch(() => [] as Array<{ min_start: number | null; max_end: number | null }>);
  const hr = hourRows[0];
  const effectiveRange: [number, number] =
    hr?.min_start != null && hr?.max_end != null
      ? [Number(hr.min_start), Number(hr.max_end)]
      : [6, 22];
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
      await releaseEntryFailed({ entryId: entry.id, triggerId: entry.triggerId, nickId, reason: 'no phone_e164' });
      return;
    }

    logger.info(
      `[nick-worker] ${nickId} claimed entry=${entry.id} phone=${entry.phoneE164} row=${entry.rowIndex} trigger=${entry.triggerId}`,
    );

    // Load trigger for greeting template + successor sequence (snapshot at dispatch time)
    // Wave 4 #D 2026-06-02 — also load multiNickThreshold + owner cho runtime guard.
    // UI cho phép chỉnh threshold sau khi trigger active → precompute đã chạy không
    // thể re-filter pool. Runtime check ở đây bám theo giá trị mới nhất trong DB.
    const trigger = await prisma.automationTrigger.findUnique({
      where: { id: entry.triggerId },
      select: {
        greetingTemplate: true,
        successorSequenceId: true,
        segmentSpec: true,
        multiNickThreshold: true,
        createdById: true,
        orgId: true,
      },
    });
    if (!trigger) {
      await releaseEntryFailed({ entryId: entry.id, triggerId: entry.triggerId, nickId, reason: 'trigger not found' });
      return;
    }

    // ── Multi-nick threshold runtime guard ──
    // Apply chỉ khi threshold > 0 (0 = OFF) VÀ entry đã có contactId (CSV mới
    // chưa resolve Contact thì bỏ qua — precompute đã filter theo contact_id rồi).
    // Reuse checkMultiNickThreshold (worker-guards.ts) — dept-aware Privacy v2
    // count friends scoped tới allowedNickIds theo role + DepartmentMember tree.
    if (trigger.multiNickThreshold > 0 && entry.contactId) {
      const mnGuard = await checkMultiNickThreshold(entry.contactId, {
        multiNickThreshold: trigger.multiNickThreshold,
        triggerOwnerUserId: trigger.createdById,
        orgId: trigger.orgId,
      });
      if (!mnGuard.passed) {
        // #2 2026-06-06 — trạng thái hàng đợi ở bảng nối per-trigger.
        await prisma.triggerQueueEntry.update({
          where: { triggerId_customerListEntryId: { triggerId: entry.triggerId, customerListEntryId: entry.id } },
          data: { queueStatus: 'skipped_friend_cap', lockedAt: null, claimedByNickId: null },
        });
        logger.info(
          `[nick-worker] ${nickId} entry=${entry.id} skipped_friend_cap reason=${mnGuard.reason} threshold=${trigger.multiNickThreshold}`,
        );
        return;
      }
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
        // #2 2026-06-06 — TÁCH: hasZalo (data khách) giữ trên entry; queueStatus → bảng nối.
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: { hasZalo: false },
        });
        await prisma.triggerQueueEntry.update({
          where: { triggerId_customerListEntryId: { triggerId: entry.triggerId, customerListEntryId: entry.id } },
          data: { queueStatus: 'skipped_status' },
        });
        logger.info(`[nick-worker] ${nickId} entry=${entry.id} skipped: no Zalo profile for phone`);
        return;
      }
      resolvedUid = found.uid;
      // Extract gender + name + avatar from Zalo profile
      // FIX 2026-06-08 (Anh báo + verify SDK live): Zalo trả 0=NAM, 1=NỮ. Code cũ map
      // NGƯỢC (0=female) → KH nam bị ghi nữ ngay lúc search phone→UID trong friend-invite.
      const profile = found as Record<string, unknown>;
      const rawGender = profile.gender;
      if (rawGender === 'male' || rawGender === 0 || rawGender === '0') zaloGender = 'male';
      else if (rawGender === 'female' || rawGender === 1 || rawGender === '1') zaloGender = 'female';
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

      // 2.3: Send friend request — guarded by Redis sentinel for crash idempotency.
      // Pre-check: nếu trước đó tick này đã send success NHƯNG worker crash trước
      // Phase 3 (DB write) → entry quay pool qua stuck sweeper → tick này pick lại.
      // Sentinel cho biết "đã gửi rồi, đừng gửi nữa" trong window 5 phút.
      const existingSentinel = await readPhase2Sentinel(entry.id, nickId);
      const sentinelAgeMs = existingSentinel ? Date.now() - existingSentinel.sentAt : Infinity;
      if (existingSentinel && sentinelAgeMs < PHASE2_SENTINEL_FRESH_MS) {
        logger.warn(
          `[nick-worker] ${nickId} entry=${entry.id} Phase2 sentinel hit (age=${Math.round(sentinelAgeMs / 1000)}s leadgen=${existingSentinel.leadgenId}) — skip resend, replay Phase 3`,
        );
        zaloLeadgenId = existingSentinel.leadgenId || '';
        // Phase 3 path tiếp tục dùng zaloLeadgenId này — KHÔNG gọi sendFriendRequest.
      } else {
        if (existingSentinel) {
          logger.info(
            `[nick-worker] ${nickId} entry=${entry.id} Phase2 sentinel stale (age=${Math.round(sentinelAgeMs / 1000)}s > ${PHASE2_SENTINEL_FRESH_MS / 1000}s) — retry send`,
          );
        }
        // Pre-write sentinel với leadgenId rỗng để cover edge case:
        // process crash BETWEEN `sendFriendRequest` resolve và sentinel write.
        // Nếu key này tồn tại lúc retry, ít nhất ta biết "đã thử send" → skip
        // (lựa chọn an toàn theo hướng under-send hơn over-send).
        await writePhase2Sentinel(entry.id, nickId, { sentAt: Date.now(), leadgenId: '' });

        const sendResult = await zaloOps.sendFriendRequest(nickId, greeting, resolvedUid);
        // sendResult format từ zca-js — pick leadgen id if available
        const sr = sendResult as Record<string, unknown> | undefined;
        zaloLeadgenId = String(sr?.reqId ?? sr?.requestId ?? sr?.id ?? '');

        // Update sentinel với leadgenId thực tế (giữ nguyên sentAt từ pre-write,
        // không lùi clock — fairness với sweeper 5 phút).
        await writePhase2Sentinel(entry.id, nickId, {
          sentAt: existingSentinel?.sentAt ?? Date.now(),
          leadgenId: zaloLeadgenId,
        });
      }

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
      //
      // Cũng cover code 222 — Zalo SDK: KH đã gửi lời mời cho nick từ trước,
      // request này được Zalo tự động xử lý như "accept" → 2 bên thành bạn ngay.
      // Flow xử lý: y hệt 'already friend' (mark processed + enroll sequence).
      // Ref: zca-js dist/apis/sendFriendRequest.js note @ line 11-13.
      if (
        msg.includes('đã là bạn') ||
        msg.includes('already friend') ||
        code === 'ALREADY_FRIEND' ||
        code === 222 ||
        code === '222'
      ) {
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

      // Detect code 215 — KH đã chặn nick từ trước (block detected lúc gửi lời mời).
      // KHÔNG hard fail (sai semantic — KH chặn không phải lỗi nick), KHÔNG enroll sequence.
      // Flow: mark entry customer_block + insert outbox sendStatus='blocked_by_user' +
      // log event 'customer_block_detected_on_invite'. Drainer sẽ skip outbox row
      // vì sendStatus không nằm trong {'success','tentative'}.
      // Ref: zca-js dist/apis/sendFriendRequest.js note @ line 11-13.
      if (code === 215 || code === '215' || msg.includes('blocked')) {
        logger.info(`[nick-worker] ${nickId} entry=${entry.id} customer_block detected on invite (code=215)`);
        // Persist enrichment first nếu có (để Lead Pool / Privacy / dedup vẫn dùng được).
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
        let blockedContactId: string | null = null;
        try {
          blockedContactId = await resolveContactIdForEntry(
            entry,
            worker.orgId,
            resolvedUid
              ? {
                  nickId,
                  zaloUid: resolvedUid,
                  zaloName: resolvedDisplayName,
                  avatarUrl: resolvedAvatarUrl,
                  gender: zaloGender ?? null,
                }
              : null,
          );
        } catch (resolveErr) {
          logger.warn(
            `[nick-worker] ${nickId} entry=${entry.id} resolveContact failed on customer_block path:`,
            resolveErr,
          );
        }
        // ── Sprint v3 (2026-06-03) — Sửa 3.6 ──
        // Anh chốt: code 215 (KH chặn) CHỈ append N3 vào failedNickIds, KHÔNG khoá
        // toàn entry sang 'customer_block'. Lý do: chặn nick 1-2 KHÔNG nghĩa nick
        // 3-4-5 không gửi được cho KH. Entry giữ queueStatus='queued_for_pickup'
        // để các nick khác claim thử. Nếu TẤT CẢ nick bị KH chặn (failedNickIds.length
        // >= segmentSpec.nickIds.length), exhausted-sweeper sẽ flip failed_permanent
        // đúng nghĩa "KH chặn cả org".
        await releaseEntryFailed({
          entryId: entry.id,
          triggerId: entry.triggerId,
          nickId,
          reason: `code215_blocked_by_user ${msg}`.slice(0, 200),
        });
        // Insert outbox row với sendStatus='blocked_by_user'. KHÔNG dùng markEntrySent
        // vì hàm đó set sendStatus='success' + tạo WELCOME_PROBE row (sai semantic).
        if (blockedContactId) {
          try {
            await prisma.friendRequestOutbox.upsert({
              where: {
                customerListEntryId_kind: {
                  customerListEntryId: entry.id,
                  kind: 'FRIEND_REQUEST',
                },
              },
              create: {
                customerListEntryId: entry.id,
                triggerId: entry.triggerId,
                nickId,
                contactId: blockedContactId,
                successorSequenceId: trigger.successorSequenceId,
                sequenceVersionSnapshot: undefined,
                sendStatus: 'blocked_by_user',
                zaloLeadgenId: '',
                kind: 'FRIEND_REQUEST',
                allowStrangerMessage: false,
                lastErrorMessage: `code=215 ${msg}`.slice(0, 500),
              },
              update: {
                sendStatus: 'blocked_by_user',
                lastErrorMessage: `code=215 ${msg}`.slice(0, 500),
              },
            });
          } catch (outboxErr) {
            logger.warn(
              `[nick-worker] ${nickId} entry=${entry.id} outbox upsert failed on customer_block path:`,
              outboxErr,
            );
          }
          // Log event để anh thấy trong tab Log sự kiện.
          const cd = resolvedDisplayName?.trim() || entry.nameRaw?.trim() || entry.phoneE164 || 'KH';
          const nd = nick.displayName?.trim() || nickId.slice(0, 8);
          void logEvent({
            orgId: worker.orgId,
            triggerId: entry.triggerId,
            contactId: blockedContactId,
            nickId,
            eventType: 'customer_block_detected_on_invite',
            eventPriority: 'urgent',
            summary: `🚫 ${cd} đã chặn nick ${nd} từ trước — bỏ qua kết bạn (row #${entry.rowIndex})`,
            metadata: { rowIndex: entry.rowIndex, phoneE164: entry.phoneE164, zaloErrorCode: 215 },
          });
        }
        return;
      }

      // Detect giới hạn PHÍA NICK (không phải lỗi của KH) — phải xử như soft-fail.
      // Fix 2026-06-06 (Anh báo + verify):
      //   - 221 "Vượt quá số request cho phép" — rate-limit tạm thời, reset theo ngày.
      //   - 224 "...xoá bớt bạn bè / nâng cấp zBusiness" — danh bạ nick ĐẦY.
      // Cả 2 trước đây rơi nhánh hard-fail → append failedNickIds → KH bị đánh
      // failed_permanent OAN khi mọi nick cùng dính. Bản chất là "nick này tạm thời
      // không gửi được", KHÔNG phải "KH này hỏng". Soft-fail: thả KH về queue cho
      // nick KHÁC gửi; nick dính giới hạn tự bỏ lượt, hồi khi Zalo nới / admin dọn bạn.
      const isNickLimit =
        code === 221 || code === '221' ||
        code === 224 || code === '224' ||
        msg.includes('Vượt quá số request') ||
        msg.includes('số request cho phép') ||
        msg.includes('xoá bớt bạn bè') ||
        msg.includes('zBusiness') ||
        msg.includes('zalo:221') ||
        msg.includes('zalo:224');

      // Distinguish RATE_LIMITED (retry) vs hard error (release pool)
      if (code === 'RATE_LIMITED' || code === 'NOT_CONNECTED' || msg.includes('timeout') || isNickLimit) {
        // ── Sprint v3 (2026-06-03) — Sửa 2.5 + 3.8 ──
        // Anh chốt: BỎ SOFT_FAIL_CAP escalate. Nick offline thì SKIP TURN (release
        // entry về queue, tăng rateLimitCount cho metric), nick online lại sẽ pick
        // bình thường. KHÔNG cấm nick vĩnh viễn vì lỗi tạm thời (timeout/socket/221).
        // failedNickIds CHỈ append khi lỗi cứng thật (KH chặn / KH không có Zalo).
        // #2 2026-06-06 — trạng thái hàng đợi ở bảng nối per-trigger.
        const updated = await prisma.triggerQueueEntry.update({
          where: { triggerId_customerListEntryId: { triggerId: entry.triggerId, customerListEntryId: entry.id } },
          data: {
            queueStatus: 'queued_for_pickup',
            claimedByNickId: null,
            lockedAt: null,
            rateLimitCount: { increment: 1 },
          },
          select: { rateLimitCount: true },
        });
        logger.warn(
          `[nick-worker] ${nickId} entry=${entry.id} soft fail (${isNickLimit ? 'ZALO_NICK_LIMIT_221/224' : code || 'timeout'}) count=${updated.rateLimitCount} — skip turn, KHÔNG escalate (Sprint v3): ${msg}`,
        );
      } else {
        // Hard fail — append failedNickIds
        await releaseEntryFailed({
          entryId: entry.id,
          triggerId: entry.triggerId,
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

    // Sprint v3 Tuần 3 Row 2.2: emit socket realtime cho Mục tiêu Detail dashboard.
    // Org-scoped, fire-and-forget. ioRef có thể null nếu nick spawn trước app.ts setIO.
    ioRef?.to(`org:${worker.orgId}`).emit('friend-invite:claimed', {
      entryId: entry.id,
      contactId,
      contactName: contactDisplayForLog,
      nickId,
      nickName: nickDisplayForLog,
      claimedAt: new Date().toISOString(),
      triggerId: entry.triggerId,
      rowIndex: entry.rowIndex,
    });
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
 * Helper dùng chung (bootstrap + sweeper): spawn worker cho mọi nick connected gắn
 * Mục tiêu friend_invite_to_list đang active mà CHƯA có worker. startNickWorker idempotent
 * (skip nếu đã trong nickWorkers map) → gọi lặp an toàn.
 *
 * @returns { spawned, needed } — spawned = số worker MỚI vừa tạo; needed = tổng nick cần worker.
 */
async function ensureNickWorkers(): Promise<{ spawned: number; needed: number }> {
  // Nick đang connected
  const nicks = await prisma.zaloAccount.findMany({
    where: { status: 'connected' },
    select: { id: true, orgId: true },
  });
  if (nicks.length === 0) return { spawned: 0, needed: 0 };

  // Nick gắn Mục tiêu friend_invite active
  const activeNickIds = new Set<string>();
  const activeTriggers = await prisma.automationTrigger.findMany({
    where: { eventType: 'friend_invite_to_list', state: 'active' },
    select: { segmentSpec: true },
  });
  for (const t of activeTriggers) {
    const spec = t.segmentSpec as { nickIds?: string[] } | null;
    if (spec?.nickIds) for (const nid of spec.nickIds) activeNickIds.add(nid);
  }

  let spawned = 0;
  let needed = 0;
  for (const nick of nicks) {
    if (!activeNickIds.has(nick.id)) continue;
    needed++;
    if (nickWorkers.has(nick.id)) continue; // đã có worker → skip
    await startNickWorker(nick.id, nick.orgId);
    if (nickWorkers.has(nick.id)) spawned++; // chỉ đếm nếu spawn thành công (lock acquired)
  }
  return { spawned, needed };
}

/**
 * Bootstrap: spawn workers cho mọi connected ZaloAccount gắn trigger active.
 * Called once from app.ts on server start.
 */
export async function bootstrapFriendInviteWorkers(): Promise<void> {
  const { spawned, needed } = await ensureNickWorkers();
  logger.info(`[nick-worker] bootstrap done: spawned ${spawned}/${needed} workers`);
  // FIX 2026-06-08 (Anh chốt): khởi động sweeper RESPAWN. Bootstrap chạy 1 lần lúc boot,
  // nếu nick chưa connect kịp (sau restart nick cần vài giây-phút re-login) → spawn 0/thiếu
  // worker, luồng chết âm thầm tới lần restart kế. Sweeper quét mỗi 30s, spawn bù worker cho
  // nick đã connected + gắn trigger active mà còn thiếu → tự hồi sau MỌI restart, không cần
  // restart tay. Idempotent qua startNickWorker (skip nick đã có worker).
  startNickRespawnSweeper();
}

// ── Respawn sweeper (FIX 2026-06-08) ──
let respawnSweeperInterval: NodeJS.Timeout | null = null;
export function startNickRespawnSweeper(): void {
  if (respawnSweeperInterval) return; // đã chạy
  respawnSweeperInterval = setInterval(() => {
    void ensureNickWorkers()
      .then(({ spawned, needed }) => {
        if (spawned > 0) {
          logger.info(
            `[nick-worker] respawn-sweeper: spawned ${spawned} worker còn thiếu (tổng cần ${needed})`,
          );
        }
      })
      .catch((err) => logger.warn(`[nick-worker] respawn-sweeper error: ${(err as Error).message}`));
  }, 30_000);
}
export function stopNickRespawnSweeper(): void {
  if (respawnSweeperInterval) {
    clearInterval(respawnSweeperInterval);
    respawnSweeperInterval = null;
  }
}

/**
 * Respawn tức thì 1 nick vừa chuyển 'connected' (gọi từ zalo-pool.updateAccountDB).
 * Chỉ spawn nếu nick gắn ít nhất 1 Mục tiêu friend_invite active VÀ chưa có worker.
 * Idempotent — startNickWorker tự skip nếu đã có worker.
 */
export async function respawnNickWorkerIfActive(nickId: string, orgId: string): Promise<void> {
  if (nickWorkers.has(nickId)) return; // đã có worker
  // Nick này có gắn Mục tiêu friend_invite active không?
  const active = await prisma.automationTrigger.findFirst({
    where: {
      eventType: 'friend_invite_to_list',
      state: 'active',
      segmentSpec: { path: ['nickIds'], array_contains: nickId },
    },
    select: { id: true },
  });
  if (!active) return; // nick không phục vụ Mục tiêu nào → không cần worker
  await startNickWorker(nickId, orgId);
  if (nickWorkers.has(nickId)) {
    logger.info(`[nick-worker] respawn-on-connect: spawned worker cho nick=${nickId} vừa online lại`);
  }
}
