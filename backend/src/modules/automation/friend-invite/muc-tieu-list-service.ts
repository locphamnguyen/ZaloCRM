// Phase Friend Invite Queue 2026-05-30 — Service "list Mục tiêu" cho org.
//
// GET /api/v1/automation/muc-tieu/list (+ alias /triggers/list-muc-tieu) gọi
// hàm `listMucTieuForOrg` này. Mỗi row trả về:
//   - meta (id, name, state, createdAt, createdBy, sourceList, sequenceName, nickCount)
//   - progress (processed / totalEntries) — đếm từ CustomerListEntry queueStatus
//   - counters (friendSent, friendAccepted, replyCount, blockCount) — aggregate
//     parallel từ FriendRequestOutbox + Friend + AutomationTask (Wave 3 stub 0)
//   - lastActivityAt — MAX(FriendRequestOutbox.createdAt) per trigger
//                      (note: outbox không có updatedAt, dùng createdAt làm proxy
//                       — chấp nhận approximation, ghi trong openIssues)
//
// Performance:
//   - 1 findMany triggers (with include)
//   - 1 groupBy state cho statusCounts (toàn bộ triggers của org)
//   - Per trigger: 6 song song qua Promise.all → batch hết qua Promise.all bên ngoài
//   - Default limit 50; không cursor pagination — defer Wave 4
//
// Wave 2 trigger CHƯA có cột stoppedReason trên AutomationTask → reply/block
// counters fallback = 0 (defensive). Khi engine ship stop-on-reply/block, đổi
// implement bên trong, không ảnh hưởng response shape.

import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { isFriendInviteSegmentSpec } from './skip-precompute.js';

// ── Types ──────────────────────────────────────────────────────────────────

// BE T4 2026-05-30 — `scheduled` là UI-derived state (KHÔNG persist trong DB).
// Khi DB row state='draft' AND scheduledAt != null → UI/list trả 'scheduled'.
// Cron sweep flip 'draft'→'active' khi tới giờ + clear scheduledAt.
export type MucTieuListState = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled' | 'scheduled';

export interface MucTieuListItem {
  id: string;
  name: string;
  state: MucTieuListState;
  createdAt: string;
  createdBy: { id: string; displayName: string };
  sourceList: { id: string; name: string; totalEntries: number } | null;
  sequenceName: string | null;
  nickCount: number;
  // Phase Friend Invite UI 2026-05-30 — FE adapter dùng nickIds[] để bulk-load
  // ZaloAccount (gom unique từ cả page → 1 GET /zalo-accounts) rồi map sang
  // { id, displayName } cho avatar group. Không bulk-load trên BE để giữ
  // service nhẹ + tránh N+1 join zaloAccount mỗi trigger.
  nickIds: string[];
  progress: { totalContacts: number; processed: number; percent: number };
  counters: {
    friendSent: number;
    friendAccepted: number;
    replyCount: number;
    blockCount: number;
  };
  // Phase Friend Invite UI 2026-05-30 — 5 counter mới hiển thị TRỰC TIẾP trên row list
  // (mockup Mục tiêu overview): Tổng KH / Có Zalo / Không Zalo / Đã xử lý / Hoàn tất KH.
  // - totalEntries = tổng CustomerListEntry gán cho trigger này
  // - hasZaloCount = entry.hasZalo=true
  // - noZaloCount  = entry.hasZalo=false
  // - processedCount = entry.queueStatus='processed' (đã pickup xong skip-precompute + friend-send)
  // - completedKHCount = KH đã đi qua hết Sequence (derive từ AutomationTask
  //   sequenceId=trigger.sequenceId AND state IN ('done','skipped')) → semantic "Hoàn tất"
  //   theo helper deriveKHFinalState ('sequence_done'). Aggregate per trigger.
  totalEntries: number;
  hasZaloCount: number;
  noZaloCount: number;
  processedCount: number;
  completedKHCount: number;
  lastActivityAt: string | null;
  // BE T4 2026-05-30 — ISO khi state='scheduled' (FE render countdown "Sẽ chạy lúc HH:mm dd/MM").
  // null khi trigger không lên lịch (chế độ "now").
  scheduledAt: string | null;
}

export interface MucTieuListResponse {
  items: MucTieuListItem[];
  total: number;
  filters: {
    statusCounts: {
      all: number;
      active: number;
      paused: number;
      completed: number;
      draft: number;
      // BE T4 2026-05-30 — `scheduled` count = state='draft' AND scheduledAt set (future).
      // `cancelled` count exposed cho UI filter chip riêng (mặc định "all" vẫn skip cancelled).
      scheduled: number;
      cancelled: number;
    };
  };
}

export interface ListMucTieuOptions {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────

// BE T4 2026-05-30 — 'scheduled' là UI-only state; KHÔNG có trong DB column.
// Filter status='scheduled' phải map sang `state='draft' AND scheduledAt IS NOT NULL`
// trong WHERE (xử lý ở listMucTieuForOrg). normalizeState cũng tính lại scheduled
// từ raw row (state + scheduledAt).
const VALID_STATES: ReadonlySet<MucTieuListState> = new Set([
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
  'scheduled',
]);

function isValidState(s: string | undefined): s is MucTieuListState {
  return !!s && VALID_STATES.has(s as MucTieuListState);
}

function normalizeState(
  s: string | null | undefined,
  scheduledAt: Date | null | undefined = null,
): MucTieuListState {
  // 'scheduled' = draft + scheduledAt future (chưa tới giờ).
  if (s === 'draft' && scheduledAt && scheduledAt.getTime() > Date.now()) {
    return 'scheduled';
  }
  if (s && VALID_STATES.has(s as MucTieuListState)) return s as MucTieuListState;
  return 'draft';
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Trả danh sách Mục tiêu (friend_invite_to_list trigger) cho 1 org kèm
 * counters + progress + lastActivity. Skip `cancelled` mặc định để UI list
 * "đang chạy / đã xong" sạch — admin xem cancelled qua filter explicit.
 */
export async function listMucTieuForOrg(
  orgId: string,
  options: ListMucTieuOptions = {},
): Promise<MucTieuListResponse> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const search = options.search?.trim() ?? '';
  const statusFilter = isValidState(options.status) ? options.status : null;

  // ── Base WHERE (always restrict to org + friend_invite event type) ──────
  const baseWhere: Prisma.AutomationTriggerWhereInput = {
    orgId,
    eventType: 'friend_invite_to_list',
  };

  // ── statusCounts (groupBy state across ALL friend_invite triggers of org)
  // Compute first so we have the global "all" count BEFORE applying status filter.
  const stateGroups = await prisma.automationTrigger.groupBy({
    by: ['state'],
    where: baseWhere,
    _count: { id: true },
  });
  const statusCounts = {
    all: 0,
    active: 0,
    paused: 0,
    completed: 0,
    draft: 0,
    scheduled: 0,
    cancelled: 0,
  };
  for (const g of stateGroups) {
    // "all" excludes cancelled to match the default list view (skip cancelled).
    if (g.state !== 'cancelled') statusCounts.all += g._count.id;
    if (g.state === 'active') statusCounts.active += g._count.id;
    else if (g.state === 'paused') statusCounts.paused += g._count.id;
    else if (g.state === 'completed') statusCounts.completed += g._count.id;
    else if (g.state === 'draft') statusCounts.draft += g._count.id;
    else if (g.state === 'cancelled') statusCounts.cancelled += g._count.id;
  }
  // BE T4 2026-05-30 — 'scheduled' = state='draft' AND scheduledAt IS NOT NULL.
  // Separate count query vì groupBy state không phân biệt được scheduled vs pure draft.
  // Lưu ý: scheduled count được TRỪ khỏi statusCounts.draft để 2 chip không cộng dồn
  // trùng. statusCounts.all giữ nguyên (scheduled là subset của draft, đã đếm).
  const scheduledCount = await prisma.automationTrigger.count({
    where: { ...baseWhere, state: 'draft', scheduledAt: { not: null } },
  });
  statusCounts.scheduled = scheduledCount;
  statusCounts.draft = Math.max(0, statusCounts.draft - scheduledCount);

  // ── Apply listing WHERE ───────────────────────────────────────────────────
  const listWhere: Prisma.AutomationTriggerWhereInput = { ...baseWhere };

  if (statusFilter === 'scheduled') {
    // BE T4 2026-05-30 — 'scheduled' không phải DB state, map sang composite.
    listWhere.state = 'draft';
    listWhere.scheduledAt = { not: null };
  } else if (statusFilter === 'draft') {
    // Draft "thuần tuý" — loại scheduled ra để FE chip không trùng count.
    listWhere.state = 'draft';
    listWhere.scheduledAt = null;
  } else if (statusFilter) {
    listWhere.state = statusFilter;
  } else {
    // Default: skip cancelled (matches statusCounts.all)
    listWhere.state = { not: 'cancelled' };
  }

  // Search matches trigger.name OR customerList.name. CustomerList is referenced
  // via segmentSpec.listId (JSON path) — we can't JOIN directly here, so we
  // resolve in two steps: (a) name LIKE, (b) collect listIds whose CustomerList
  // name matches, OR them into segmentSpec JSON contains predicate.
  if (search) {
    const matchingLists = await prisma.customerList.findMany({
      where: { orgId, name: { contains: search, mode: 'insensitive' } },
      select: { id: true },
      take: 500, // safety cap — large match sets fall back to name-only
    });
    const listIds = matchingLists.map((l) => l.id);
    const orClauses: Prisma.AutomationTriggerWhereInput[] = [
      { name: { contains: search, mode: 'insensitive' } },
    ];
    for (const lid of listIds) {
      orClauses.push({
        segmentSpec: {
          path: ['listId'],
          equals: lid,
        } as object,
      });
    }
    listWhere.OR = orClauses;
  }

  // ── Total count for pagination ──────────────────────────────────────────
  const total = await prisma.automationTrigger.count({ where: listWhere });

  // ── Fetch triggers page ─────────────────────────────────────────────────
  const triggers = await prisma.automationTrigger.findMany({
    where: listWhere,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
    include: {
      createdBy: { select: { id: true, fullName: true } },
      sequence: { select: { id: true, name: true } },
    },
  });

  if (triggers.length === 0) {
    return { items: [], total, filters: { statusCounts } };
  }

  // ── Bulk-load referenced CustomerLists (segmentSpec.listId) ────────────
  const listIdsReferenced = new Set<string>();
  for (const t of triggers) {
    const spec = t.segmentSpec;
    if (isFriendInviteSegmentSpec(spec)) listIdsReferenced.add(spec.listId);
  }
  const lists =
    listIdsReferenced.size > 0
      ? await prisma.customerList.findMany({
          where: { id: { in: [...listIdsReferenced] }, orgId },
          select: { id: true, name: true, totalEntries: true },
        })
      : [];
  const listById = new Map(lists.map((l) => [l.id, l]));

  // ── Per-trigger aggregates (parallel) ───────────────────────────────────
  const items = await Promise.all(
    triggers.map(async (t): Promise<MucTieuListItem> => {
      const spec = t.segmentSpec;
      const isValidSpec = isFriendInviteSegmentSpec(spec);
      const nickIds = isValidSpec ? spec.nickIds : [];
      const sourceListId = isValidSpec ? spec.listId : null;
      const sourceList = sourceListId ? listById.get(sourceListId) ?? null : null;

      const [
        processedCount,
        totalContactsCount,
        hasZaloCount,
        noZaloCount,
        friendSent,
        acceptedContactIds,
        replyCount,
        blockCount,
        lastOutbox,
      ] = await Promise.all([
        // 1. processed entries for this trigger
        prisma.customerListEntry.count({
          where: { triggerId: t.id, queueStatus: 'processed' },
        }),
        // 2. total entries assigned to this trigger (queue pool size)
        prisma.customerListEntry.count({
          where: { triggerId: t.id },
        }),
        // 2a. hasZalo=true entries (đã quét + có Zalo)
        prisma.customerListEntry.count({
          where: { triggerId: t.id, hasZalo: true },
        }),
        // 2b. hasZalo=false entries (đã quét + không có Zalo / SDK 404)
        prisma.customerListEntry.count({
          where: { triggerId: t.id, hasZalo: false },
        }),
        // 3. friend requests sent (success OR tentative)
        prisma.friendRequestOutbox.count({
          where: {
            triggerId: t.id,
            sendStatus: { in: ['success', 'tentative'] },
            kind: 'FRIEND_REQUEST',
          },
        }),
        // 4. friendAccepted — query distinct contactIds touched by this trigger,
        // then count accepted Friend rows for that set scoped to org.
        // Two-step keeps the JOIN bounded by trigger's contact set.
        prisma.customerListEntry
          .findMany({
            where: { triggerId: t.id, contactId: { not: null } },
            select: { contactId: true },
          })
          .then((rows) => rows.map((r) => r.contactId).filter((x): x is string => !!x)),
        // 5. replyCount — Wave 3, AutomationTask.skipReason='reply'. Returns 0
        // defensively when the engine hasn't started writing this yet.
        safeTaskSkipReasonCount(orgId, t.id, 'reply'),
        // 6. blockCount — Wave 3, AutomationTask.skipReason='block'
        safeTaskSkipReasonCount(orgId, t.id, 'block'),
        // 7. lastActivityAt approximation — most-recent outbox row for trigger
        prisma.friendRequestOutbox.findFirst({
          where: { triggerId: t.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      // friendAccepted: count accepted Friend rows for those contacts in org
      let friendAccepted = 0;
      if (acceptedContactIds.length > 0) {
        friendAccepted = await prisma.friend.count({
          where: {
            orgId,
            contactId: { in: acceptedContactIds },
            friendshipStatus: 'accepted',
          },
        });
      }

      // completedKHCount — KH đã đi hết Sequence (semantic deriveKHFinalState='sequence_done').
      // Đếm distinct contactId có AutomationTask khớp sequence của trigger + state in ('done','skipped').
      // Distinct qua groupBy để tránh đếm trùng khi 1 KH có nhiều task row cho sequence.
      let completedKHCount = 0;
      if (acceptedContactIds.length > 0 && t.sequenceId) {
        const doneGroups = await (prisma as any).automationTask.groupBy({
          by: ['contactId'],
          where: {
            orgId,
            sequenceId: t.sequenceId,
            contactId: { in: acceptedContactIds },
            state: { in: ['done', 'skipped'] },
          },
        });
        completedKHCount = doneGroups.length;
      }

      const percent =
        totalContactsCount > 0
          ? Math.min(100, Math.round((processedCount / totalContactsCount) * 100))
          : 0;

      return {
        id: t.id,
        name: t.name,
        // BE T4 2026-05-30 — derive 'scheduled' khi draft + scheduledAt future.
        state: normalizeState(t.state, t.scheduledAt),
        createdAt: t.createdAt.toISOString(),
        createdBy: {
          id: t.createdBy.id,
          displayName: t.createdBy.fullName,
        },
        sourceList: sourceList
          ? {
              id: sourceList.id,
              name: sourceList.name,
              totalEntries: sourceList.totalEntries,
            }
          : null,
        sequenceName: t.sequence?.name ?? null,
        nickCount: nickIds.length,
        // Phase Friend Invite UI 2026-05-30 — expose raw nickIds cho FE adapter bulk-load.
        nickIds,
        progress: {
          totalContacts: totalContactsCount,
          processed: processedCount,
          percent,
        },
        counters: {
          friendSent,
          friendAccepted,
          replyCount,
          blockCount,
        },
        // Phase Friend Invite UI 2026-05-30 — flat counters cho row list
        totalEntries: totalContactsCount,
        hasZaloCount,
        noZaloCount,
        processedCount,
        completedKHCount,
        lastActivityAt: lastOutbox?.createdAt ? lastOutbox.createdAt.toISOString() : null,
        scheduledAt: t.scheduledAt ? t.scheduledAt.toISOString() : null,
      };
    }),
  );

  return {
    items,
    total,
    filters: { statusCounts },
  };
}

/**
 * Defensive helper: AutomationTask.skipReason='reply'/'block' chưa được engine
 * stop-on-reply ship (Wave 2). Bọc try/catch để 1 query lỗi không bể cả list.
 */
async function safeTaskSkipReasonCount(
  orgId: string,
  triggerId: string,
  reason: 'reply' | 'block',
): Promise<number> {
  try {
    return await (prisma as any).automationTask.count({
      where: {
        orgId,
        skipReason: reason,
        campaign: {
          triggerId,
        },
      },
    });
  } catch (err) {
    logger.debug(
      `[muc-tieu-list] safeTaskSkipReasonCount(${reason}) for trigger=${triggerId} returned 0 (${err instanceof Error ? err.message : String(err)})`,
    );
    return 0;
  }
}
