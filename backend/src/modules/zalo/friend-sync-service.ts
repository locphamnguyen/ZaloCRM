/**
 * friend-sync-service.ts — Canonical Friend full-sync (Zalo SDK → CRM Friend table).
 *
 * Single entry point cho mọi trigger:
 *  - Manual: POST /friends-db/sync (user click "↻ Làm mới ngay")
 *  - On-connect: zalo-pool.autoSyncOnConnect (lần đầu nick lên)
 *  - Cron:    friend-sync-cron.ts every 15 min cho mọi connected account
 *
 * Pull list:
 *  - api.getAllFriends() → accepted friends
 *  - api.getSentFriendRequests() → pending_sent invitations
 *
 * Diff-then-emit (P10 trong eng-review):
 *  - Trước khi update, load Friend row existing → compute patch chỉ-cột-đổi.
 *  - Empty patch → SKIP update + SKIP emit. Typical cron run với Zalo state stable
 *    sẽ emit 0 events (99%+ rows no change).
 *  - Có patch → update + emit 'friend:updated' với patched fields only.
 *
 * Cooldown 5s/account khi trigger='manual' (chống user spam click). Cron + on-connect
 * KHÔNG bị cooldown chặn.
 *
 * Errors logged via logActivity({systemSource:'friend_sync_error'}) để observable
 * qua activity dashboard, KHÔNG throw lên caller (best-effort sync).
 */
import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { logActivity } from '../activity/activity-logger.js';
import { applyFriendTransition } from './friend-event-handler.js';
import { buildFriendUpdatedPayload } from '../../shared/friend-serializer.js';

export type SyncTrigger = 'manual' | 'connect' | 'cron';

export interface SyncFriendsOptions {
  trigger: SyncTrigger;
  /** Socket.IO server cho emit 'friend:updated'. Optional — null thì chỉ update DB không emit. */
  io?: Server | null;
}

export interface SyncFriendsResult {
  /** Số friend Zalo trả về (accepted + pending) */
  liveCount: number;
  /** Contact stub mới tạo do KH chưa có trong DB */
  createdContacts: number;
  /** Friend rows được upsert (cả no-change cũng đếm vì applyFriendTransition không trả diff info) */
  upsertedFriends: number;
  /** Số 'friend:updated' socket events đã emit (= số rows thực sự đổi field) */
  emittedCount: number;
  /** Số errors gặp phải khi process per-friend (chỉ log, không throw) */
  errors: number;
  durationMs: number;
  /** True khi bị cooldown 5s (chỉ áp cho trigger='manual'). Caller có thể trả 429 cho user. */
  skipped: 'cooldown' | null;
}

// ── Cooldown registry (in-process) ─────────────────────────────────────────
// 5s/account cho manual trigger. Cron + connect bỏ qua check này.
const COOLDOWN_MS = 5_000;
const lastManualSyncAt = new Map<string, number>();

// ── Diff helper ─────────────────────────────────────────────────────────────
// Fields có thể đổi từ Zalo Real → cần diff trước khi update + emit.
// Friendship state (friendshipStatus, relationshipKind) đi qua applyFriendTransition
// riêng (có state machine + counter delta), KHÔNG include trong diff snapshot này.
const DIFFABLE_FIELDS = [
  'zaloDisplayName',
  'zaloAvatarUrl',
  'zaloGlobalId',
  'zaloUsername',
] as const;
type DiffableField = (typeof DIFFABLE_FIELDS)[number];
type DiffSnapshot = Partial<Record<DiffableField, string | null>>;

function computeDiff(existing: DiffSnapshot, incoming: DiffSnapshot): DiffSnapshot {
  const patch: DiffSnapshot = {};
  for (const k of DIFFABLE_FIELDS) {
    const oldV = existing[k] ?? null;
    const newV = incoming[k] ?? null;
    if (oldV !== newV) {
      patch[k] = newV;
    }
  }
  return patch;
}

// ── Parse Zalo SDK response into snapshot ──────────────────────────────────
// zca-js getAllFriends() trả objects với key variant tuỳ phiên bản:
//   userId / uid       — primary identifier (phía nick này nhìn)
//   zaloName / displayName  — tên hiển thị
//   avatar             — URL avatar
//   globalId           — global identity (cross-nick)
//   username           — handle @abc
function extractFriendInfo(raw: Record<string, unknown>): {
  uid: string;
  snapshot: DiffSnapshot;
} | null {
  const uid = String((raw.userId ?? raw.uid ?? '') as string);
  if (!uid) return null;
  return {
    uid,
    snapshot: {
      zaloDisplayName: String((raw.zaloName ?? raw.displayName ?? '') as string) || null,
      zaloAvatarUrl: String((raw.avatar ?? '') as string) || null,
      zaloGlobalId: String((raw.globalId ?? '') as string) || null,
      zaloUsername: String((raw.username ?? '') as string) || null,
    },
  };
}

// ── Main entry ──────────────────────────────────────────────────────────────

/**
 * Full sync Friend list cho 1 nick từ Zalo SDK → CRM.
 *
 * Idempotent + best-effort:
 *  - Re-run an toàn (dedup qua @@unique([zaloAccountId, zaloUidInNick]))
 *  - SDK lỗi → catch + logActivity, không throw
 *  - Cooldown manual: trả {skipped:'cooldown'} nhanh (cron/connect bypass)
 */
export async function syncFriendsForAccount(
  accountId: string,
  orgId: string,
  opts: SyncFriendsOptions,
): Promise<SyncFriendsResult> {
  const startedAt = Date.now();
  const result: SyncFriendsResult = {
    liveCount: 0,
    createdContacts: 0,
    upsertedFriends: 0,
    emittedCount: 0,
    errors: 0,
    durationMs: 0,
    skipped: null,
  };

  // Cooldown gate cho manual trigger only
  if (opts.trigger === 'manual') {
    const lastAt = lastManualSyncAt.get(accountId) || 0;
    if (Date.now() - lastAt < COOLDOWN_MS) {
      result.skipped = 'cooldown';
      result.durationMs = Date.now() - startedAt;
      return result;
    }
    lastManualSyncAt.set(accountId, Date.now());
  }

  let liveFriends: Array<Record<string, unknown>> = [];
  let sentRequests: Array<Record<string, unknown>> = [];

  try {
    // SDK có thể trả: array | {data:[]} | {items:[]} | undefined tuỳ phiên bản zca-js.
    // Defensive normalize sang array; non-array shape coi như empty.
    const liveRaw: any = await zaloOps.getAllFriends(accountId).catch(() => []);
    const sentRaw: any = await zaloOps.getSentFriendRequests(accountId).catch(() => []);
    liveFriends = Array.isArray(liveRaw) ? liveRaw
      : Array.isArray(liveRaw?.data) ? liveRaw.data
      : Array.isArray(liveRaw?.items) ? liveRaw.items
      : [];
    sentRequests = Array.isArray(sentRaw) ? sentRaw
      : Array.isArray(sentRaw?.data) ? sentRaw.data
      : Array.isArray(sentRaw?.items) ? sentRaw.items
      : [];
  } catch (err) {
    result.errors++;
    logger.warn(`[friend-sync:${accountId}] SDK fetch failed:`, err);
    await logSyncError(orgId, accountId, opts.trigger, err, { phase: 'sdk_fetch' });
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  result.liveCount = liveFriends.length + sentRequests.length;

  // Pre-load existing Friend snapshots in 1 query để diff không N+1
  const allUids = new Set<string>();
  for (const f of liveFriends) {
    const info = extractFriendInfo(f);
    if (info) allUids.add(info.uid);
  }
  for (const r of sentRequests) {
    const info = extractFriendInfo(r);
    if (info) allUids.add(info.uid);
  }

  const existingFriends = await prisma.friend.findMany({
    where: {
      zaloAccountId: accountId,
      zaloUidInNick: { in: [...allUids] },
    },
    select: {
      id: true,
      contactId: true,
      zaloUidInNick: true,
      zaloDisplayName: true,
      zaloAvatarUrl: true,
      zaloGlobalId: true,
      zaloUsername: true,
    },
  });
  const existingByUid = new Map(existingFriends.map((f) => [f.zaloUidInNick, f]));

  // Process accepted friends → friendshipStatus='accepted'
  for (const live of liveFriends) {
    const info = extractFriendInfo(live);
    if (!info) continue;
    try {
      await processFriend({
        accountId,
        orgId,
        uid: info.uid,
        snapshot: info.snapshot,
        targetStatus: 'accepted',
        fallbackName: info.snapshot.zaloDisplayName,
        fallbackAvatar: info.snapshot.zaloAvatarUrl,
        existing: existingByUid.get(info.uid),
        io: opts.io ?? null,
        result,
      });
    } catch (err) {
      result.errors++;
      logger.warn(`[friend-sync:${accountId}] process uid=${info.uid} failed:`, err);
      await logSyncError(orgId, accountId, opts.trigger, err, {
        phase: 'process_accepted',
        uid: info.uid,
      });
    }
  }

  // Process sent requests → friendshipStatus='pending_sent'
  for (const req of sentRequests) {
    const info = extractFriendInfo(req);
    if (!info) continue;
    try {
      await processFriend({
        accountId,
        orgId,
        uid: info.uid,
        snapshot: info.snapshot,
        targetStatus: 'pending_sent',
        fallbackName: info.snapshot.zaloDisplayName,
        fallbackAvatar: info.snapshot.zaloAvatarUrl,
        existing: existingByUid.get(info.uid),
        io: opts.io ?? null,
        result,
      });
    } catch (err) {
      result.errors++;
      logger.warn(`[friend-sync:${accountId}] process pending uid=${info.uid} failed:`, err);
      await logSyncError(orgId, accountId, opts.trigger, err, {
        phase: 'process_pending',
        uid: info.uid,
      });
    }
  }

  result.durationMs = Date.now() - startedAt;
  logger.info(
    `[friend-sync:${accountId}] trigger=${opts.trigger} live=${result.liveCount} upserted=${result.upsertedFriends} emitted=${result.emittedCount} created=${result.createdContacts} errors=${result.errors} dur=${result.durationMs}ms`,
  );
  return result;
}

// ── Per-friend processing ──────────────────────────────────────────────────

interface ProcessFriendArgs {
  accountId: string;
  orgId: string;
  uid: string;
  snapshot: DiffSnapshot;
  targetStatus: 'accepted' | 'pending_sent';
  fallbackName: string | null | undefined;
  fallbackAvatar: string | null | undefined;
  existing:
    | {
        id: string;
        contactId: string;
        zaloUidInNick: string;
        zaloDisplayName: string | null;
        zaloAvatarUrl: string | null;
        zaloGlobalId: string | null;
        zaloUsername: string | null;
      }
    | undefined;
  io: Server | null;
  result: SyncFriendsResult;
}

async function processFriend(args: ProcessFriendArgs): Promise<void> {
  // 1. Resolve or create Contact
  let contact = await prisma.contact.findFirst({
    where: { orgId: args.orgId, zaloUid: args.uid },
    select: { id: true },
  });
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId: args.orgId,
        zaloUid: args.uid,
        fullName: args.fallbackName || 'Unknown',
        avatarUrl: args.fallbackAvatar || null,
        hasZalo: true,
      },
      select: { id: true },
    });
    args.result.createdContacts++;
  }

  // 2. Drive friendship state machine (handles upsert + counter delta + assignedUser)
  await applyFriendTransition({
    orgId: args.orgId,
    zaloAccountId: args.accountId,
    contactId: contact.id,
    zaloUidInNick: args.uid,
    newFriendshipStatus: args.targetStatus,
  });
  args.result.upsertedFriends++;

  // 3. Diff identity fields (name/avatar/globalId/username) → update + emit only if changed
  const existingSnap: DiffSnapshot = args.existing
    ? {
        zaloDisplayName: args.existing.zaloDisplayName,
        zaloAvatarUrl: args.existing.zaloAvatarUrl,
        zaloGlobalId: args.existing.zaloGlobalId,
        zaloUsername: args.existing.zaloUsername,
      }
    : { zaloDisplayName: null, zaloAvatarUrl: null, zaloGlobalId: null, zaloUsername: null };

  const patch = computeDiff(existingSnap, args.snapshot);
  if (Object.keys(patch).length === 0) {
    // No identity drift → skip update + skip emit
    return;
  }

  const updated = await prisma.friend.update({
    where: {
      zaloAccountId_zaloUidInNick: {
        zaloAccountId: args.accountId,
        zaloUidInNick: args.uid,
      },
    },
    data: patch,
    select: { id: true, contactId: true, zaloAccountId: true },
  });

  // Emit socket patch — FE composable use-friend-socket mutate cache row
  if (args.io) {
    const payload = buildFriendUpdatedPayload({
      friendId: updated.id,
      contactId: updated.contactId,
      zaloAccountId: updated.zaloAccountId,
      patch,
    });
    args.io.to(`org:${args.orgId}`).emit('friend:updated', payload);
    args.result.emittedCount++;
  }
}

// ── Error logging helper ───────────────────────────────────────────────────

async function logSyncError(
  orgId: string,
  accountId: string,
  trigger: SyncTrigger,
  err: unknown,
  extra: Record<string, unknown>,
): Promise<void> {
  try {
    await logActivity({
      orgId,
      systemSource: 'friend_sync_error',
      action: 'sync_failed',
      entityType: 'zalo_account',
      entityId: accountId,
      details: {
        trigger,
        error: err instanceof Error ? err.message : String(err),
        ...extra,
      },
    });
  } catch {
    // Don't recurse on log failure
  }
}
