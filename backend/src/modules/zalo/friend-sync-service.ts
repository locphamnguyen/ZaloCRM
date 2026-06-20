// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logActivity } from '../activity/activity-logger.js';
import { applyFriendTransition } from './friend-event-handler.js';
import { resolveOrCreateContact } from '../contacts/resolve-contact.js';
import { buildFriendUpdatedPayload } from '../../shared/friend-serializer.js';
// getAllFriends() trả gender/dob/sdob cùng shape getUserInfo — tái dùng parse của cron.
import { mapGender, parseBirthDate } from '../contacts/contact-profile-sync-cron.js';

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
  // Demographic Cha (Contact) — getAllFriends ĐÃ trả sẵn (User.gender/dob/sdob), không
  // tốn thêm call SDK. Ghi null-only + !genderLocked ở processFriend (xem dưới).
  gender: 'male' | 'female' | null;
  birthDate: Date | null;
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
    gender: mapGender(raw.gender),
    birthDate: parseBirthDate(raw.sdob, raw.dob),
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
  // Bọc toàn bộ org-scoped work trong tenant context (cron/connect chạy ngoài
  // request HTTP; manual route đã có context — re-establish cùng org vô hại).
  return withTenant(orgId, () => syncFriendsForAccountImpl(accountId, orgId, opts));
}

async function syncFriendsForAccountImpl(
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

  // B4 fix — SDK errors PHẢI throw lên outer catch để increment errors + logActivity.
  // Trước đây `.catch(() => [])` swallow lỗi → Zalo disconnect/rate-limit hiện liveCount=0
  // không phân biệt với "0 friends" thật, sale không biết sync fail.
  // Defensive Array.isArray normalize giữ nguyên (cho shape variants), nhưng lỗi SDK
  // (rate limit, network) bubble lên outer try/catch.
  try {
    const liveRaw: any = await zaloOps.getAllFriends(accountId);
    const sentRaw: any = await zaloOps.getSentFriendRequests(accountId);
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
        gender: info.gender,
        birthDate: info.birthDate,
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
        gender: info.gender,
        birthDate: info.birthDate,
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
  gender: 'male' | 'female' | null;
  birthDate: Date | null;
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
  // 1. Resolve or create Contact via central helper.
  //    Helper handles globalId/username/phone dedup + Friend reverse-lookup + ON CONFLICT race-safe stub.
  //    enrichViaGetUserInfo=false vì friend-sync ALREADY có full profile từ getAllFriends.
  const resolved = await resolveOrCreateContact({
    orgId: args.orgId,
    zaloAccountId: args.accountId,
    zaloUidInNick: args.uid,
    zaloGlobalId: args.snapshot.zaloGlobalId,
    zaloUsername: args.snapshot.zaloUsername,
    fallbackFullName: args.snapshot.zaloDisplayName || args.fallbackName,
    fallbackAvatarUrl: args.snapshot.zaloAvatarUrl || args.fallbackAvatar,
    enrichViaGetUserInfo: false,
  });
  if (resolved.created) args.result.createdContacts++;
  // Re-read fullName for downstream B8 backfill logic
  const contactRow = await prisma.contact.findUnique({
    where: { id: resolved.id },
    select: { id: true, fullName: true, gender: true, genderLocked: true, birthDate: true },
  });
  const contact = contactRow ?? { id: resolved.id, fullName: null, gender: null, genderLocked: false, birthDate: null };

  // 1c. Gộp các backfill Cha (Contact) vào 1 update để tránh N+1:
  //   • B8 — fullName khi Contact stub 'Unknown' mà Friend đã có zaloDisplayName từ SDK.
  //     (Stub tạo bởi resolveContact khi event đến trước message → fullName='Unknown', KH
  //     Cha stuck "Unknown" gây UI broken.) CHỈ ghi đè 'Unknown' literal — không đụng sale sửa tay.
  //   • Demographic 2026-06-18 — gender/birthDate Zalo TRẢ SẴN trong getAllFriends (0 call SDK
  //     thêm). Điền khi đang TRỐNG; gender thêm !genderLocked (chống đè chỉnh tay). 1 lần đồng
  //     bộ là fill hàng loạt thay vì chờ cron getUserInfo từng KH.
  const cPatch: Record<string, unknown> = {};
  const newName = args.snapshot.zaloDisplayName || args.fallbackName;
  if (
    newName
    && newName !== 'Unknown'
    && (contact.fullName === 'Unknown' || contact.fullName === null || contact.fullName === '' || contact.fullName === 'KH chưa rõ')
  ) {
    cPatch.fullName = newName;
    if (args.snapshot.zaloGlobalId) cPatch.zaloGlobalId = args.snapshot.zaloGlobalId;
    if (args.snapshot.zaloUsername) cPatch.zaloUsername = args.snapshot.zaloUsername;
    if (args.fallbackAvatar) cPatch.avatarUrl = args.fallbackAvatar;
  }
  if (args.gender && contact.gender == null && !contact.genderLocked) cPatch.gender = args.gender;
  if (args.birthDate && contact.birthDate == null) cPatch.birthDate = args.birthDate;
  if (Object.keys(cPatch).length) {
    await prisma.contact.update({ where: { id: contact.id }, data: cPatch });
  }

  // 2. Drive friendship state machine (handles upsert + counter delta + assignedUser).
  // source='sync' → KHÔNG set becameFriendAt vì Zalo không trả ngày kết bạn thực
  // (sync time = today gây "Đã KB hôm nay" sai cho KH cũ).
  await applyFriendTransition({
    orgId: args.orgId,
    zaloAccountId: args.accountId,
    contactId: contact.id,
    zaloUidInNick: args.uid,
    newFriendshipStatus: args.targetStatus,
    source: 'sync',
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
    select: { id: true, contactId: true, zaloAccountId: true, zaloUidInNick: true },
  });

  // Emit socket patch — FE composable use-friend-socket mutate cache row
  if (args.io) {
    const payload = buildFriendUpdatedPayload({
      friendId: updated.id,
      contactId: updated.contactId,
      zaloAccountId: updated.zaloAccountId,
      zaloUidInNick: updated.zaloUidInNick,
      patch,
    });
    args.io.to(`org:${args.orgId}`).emit('friend:updated', payload);
    args.result.emittedCount++;
  }
}

// ── Full account sync wrapper (friends + aliases + labels) ────────────────

export interface SyncAccountFullyResult {
  friends: SyncFriendsResult | null;
  aliasesUpdated: number;
  labelsUpdated: number;
  errors: string[];
  durationMs: number;
}

/**
 * Sync TOÀN BỘ identity per-pair (friends + aliases + labels) cho 1 account.
 *
 * Single entry point dùng chung cho:
 *  - friend-sync-cron.ts (mỗi 15 phút loop accounts)
 *  - zalo-pool.autoSyncOnConnect (lần đầu connect)
 *  - friend-routes /friends-db/sync (manual "↻ Làm mới ngay")
 *
 * 3 nhánh chạy parallel via Promise.allSettled — 1 nhánh fail không break 2 nhánh kia.
 * (Cron loop ngoài vẫn sequential giữa accounts để tránh burst Zalo rate-limit.)
 */
export async function syncAccountFully(
  accountId: string,
  orgId: string,
  opts: SyncFriendsOptions,
): Promise<SyncAccountFullyResult> {
  // Bọc toàn bộ (friends + labels + B8 $executeRaw backfill) trong tenant context.
  return withTenant(orgId, () => syncAccountFullyImpl(accountId, orgId, opts));
}

async function syncAccountFullyImpl(
  accountId: string,
  orgId: string,
  opts: SyncFriendsOptions,
): Promise<SyncAccountFullyResult> {
  const startedAt = Date.now();
  const result: SyncAccountFullyResult = {
    friends: null,
    aliasesUpdated: 0,
    labelsUpdated: 0,
    errors: [],
    durationMs: 0,
  };

  // B5 fix — labels full-sync internally calls syncAliasesForAccount (alias-sync.ts
  // imported lazy inside syncLabelsForAccount full path). Wrapper bỏ alias parallel
  // để tránh double getAliasList pagination + DB diff cùng account mỗi cycle.
  // Result: 2 nhánh parallel thay vì 3 (friends + labels). aliasesUpdated lấy từ
  // labelsRes.aliasesUpdated do syncLabelsForAccount propagate qua.
  const [friendsRes, labelsRes] = await Promise.allSettled([
    syncFriendsForAccount(accountId, orgId, opts),
    (async () => {
      const { syncLabelsIfStale } = await import('./zalo-labels-routes.js');
      return syncLabelsIfStale(accountId, orgId);
    })(),
  ]);

  if (friendsRes.status === 'fulfilled') {
    result.friends = friendsRes.value;
  } else {
    result.errors.push(`friends: ${friendsRes.reason instanceof Error ? friendsRes.reason.message : String(friendsRes.reason)}`);
  }
  if (labelsRes.status === 'fulfilled') {
    // syncLabelsIfStale có thể trả null (cooldown / grace) → coi như 0
    result.labelsUpdated = labelsRes.value?.friendsUpdated ?? 0;
    result.aliasesUpdated = labelsRes.value?.aliasesUpdated ?? 0;
  } else {
    result.errors.push(`labels: ${labelsRes.reason instanceof Error ? labelsRes.reason.message : String(labelsRes.reason)}`);
  }

  // B8 sweep mở rộng — backfill TẤT CẢ identity field cho Contact stub khi Friend
  // có data hơn. KHÔNG overwrite data sale đã edit:
  //   - full_name: chỉ ghi đè khi NULL/''/literal 'Unknown' (treat stub)
  //   - zalo_global_id / zalo_username / avatar_url: chỉ ghi đè khi NULL
  //     (COALESCE — sale edit avatar tay sẽ không bị reset)
  // Coverage:
  //   1. Pending_received friends (không vào getAllFriends/getSentFriendRequests loop)
  //   2. Legacy Contact tạo từ friend-event-handler/applyFriendAggregate trước Phase 6
  //      (chỉ có UID, thiếu globalId/username — sweep này fill)
  //   3. Khi user dùng UI tạo Contact manual sau đó nick CRM nhận message từ KH đó
  //
  // Sau khi sweep, Contact của cùng KH 2 nick chăm sẽ cùng zalo_global_id →
  // duplicate-detector cron 02:30 UTC sẽ auto-merge step 1 (cùng globalId).
  // Single UPDATE…FROM atomic, dùng index (org_id, zalo_global_id) + FK, <100ms cho ~3k friends.
  try {
    // CRITICAL — phải tránh @@unique([org_id, zalo_global_id]) violation khi
    // Contact A NULL globalId, Contact B đã có globalId X, cùng person 2 nicks.
    // NOT EXISTS subquery: chỉ set globalId nếu KHÔNG có Contact khác cùng org
    // đã claim globalId này. Trường hợp duplicate → giữ NULL, để duplicate-detector
    // cron handle qua step khác (name+phone hoặc fuzzy match) hoặc admin run-detector.
    // Tương tự cho zalo_username (uniqueness implicit qua data sống cùng Zalo).
    const backfilled = await prisma.$executeRaw`
      UPDATE contacts
      SET
        full_name      = COALESCE(NULLIF(NULLIF(contacts.full_name, ''), 'Unknown'), sub.f_name, contacts.full_name),
        zalo_global_id = CASE
          WHEN (contacts.zalo_global_id IS NULL OR contacts.zalo_global_id = '')
            AND sub.f_global_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM contacts c2
              WHERE c2.org_id = contacts.org_id
                AND c2.id <> contacts.id
                AND c2.zalo_global_id = sub.f_global_id
            )
          THEN sub.f_global_id
          ELSE contacts.zalo_global_id
        END,
        zalo_username  = COALESCE(contacts.zalo_username, sub.f_username),
        avatar_url     = COALESCE(contacts.avatar_url, sub.f_avatar)
      FROM (
        SELECT DISTINCT ON (f.contact_id)
          f.contact_id,
          f.zalo_display_name AS f_name,
          f.zalo_global_id    AS f_global_id,
          f.zalo_username     AS f_username,
          f.zalo_avatar_url   AS f_avatar
        FROM friends f
        WHERE f.org_id = ${orgId}
          AND f.zalo_account_id = ${accountId}
          AND (
            f.zalo_display_name IS NOT NULL AND f.zalo_display_name <> '' AND f.zalo_display_name <> 'Unknown'
            OR f.zalo_global_id IS NOT NULL AND f.zalo_global_id <> ''
            OR f.zalo_username IS NOT NULL AND f.zalo_username <> ''
            OR f.zalo_avatar_url IS NOT NULL AND f.zalo_avatar_url <> ''
          )
        ORDER BY f.contact_id, f.updated_at DESC
      ) sub
      WHERE contacts.id = sub.contact_id
        AND contacts.org_id = ${orgId}
        AND (
          (contacts.full_name IS NULL OR contacts.full_name = '' OR contacts.full_name = 'Unknown') AND sub.f_name IS NOT NULL
          OR (contacts.zalo_global_id IS NULL OR contacts.zalo_global_id = '') AND sub.f_global_id IS NOT NULL
          OR (contacts.zalo_username IS NULL OR contacts.zalo_username = '') AND sub.f_username IS NOT NULL
          OR (contacts.avatar_url IS NULL OR contacts.avatar_url = '') AND sub.f_avatar IS NOT NULL
        )
    `;
    if (backfilled > 0) {
      logger.info(`[friend-sync-full:${accountId}] B8 backfill sweep: ${backfilled} Contact stubs filled (full_name + global_id + username + avatar from Friend)`);
    }
  } catch (err) {
    logger.warn(`[friend-sync-full:${accountId}] B8 backfill sweep failed:`, err);
  }

  result.durationMs = Date.now() - startedAt;
  logger.info(
    `[friend-sync-full:${accountId}] trigger=${opts.trigger} friends_emitted=${result.friends?.emittedCount ?? 0} aliases=${result.aliasesUpdated} labels=${result.labelsUpdated} errors=${result.errors.length} dur=${result.durationMs}ms`,
  );
  return result;
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
