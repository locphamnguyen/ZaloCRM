// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * contact-aggregate-display.ts — On-demand aggregation cho KH Cha.
 *
 * Model B: mỗi Friend row = 1 "KH Con" (per nick CRM chăm).
 *   displayStatus    = status có order CAO NHẤT trong friends (fallback Contact.statusRef)
 *   displayLeadScore = AVG(friends.leadScore) — fallback Contact.leadScore khi 0 friend
 *   displayHasZalo   = friends.length > 0 ? true : Contact.hasZalo (giữ giá trị cũ)
 *
 * Prisma include shape cho friends → dùng FRIEND_INCLUDE từ shared/friend-serializer.ts
 * (canonical, dùng chung với /friends-db để tránh drift).
 */
import { FRIEND_INCLUDE, STATUS_LITE_SELECT } from '../../shared/friend-serializer.js';

interface StatusLite {
  id: string;
  name: string;
  order: number;
  color: string | null;
  isTerminal: boolean;
}

interface FriendLite {
  id: string;
  leadScore: number;
  statusRef?: StatusLite | null;
  zaloGlobalId?: string | null;
  zaloUsername?: string | null;
  zaloAccountId?: string;
  lastInboundAt?: Date | string | null;
  lastInboundPreview?: string | null;
  lastInboundType?: string | null;
  lastInboundMessageId?: string | null;
  lastOutboundAt?: Date | string | null;
  lastOutboundPreview?: string | null;
  lastOutboundType?: string | null;
  lastOutboundMessageId?: string | null;
}

interface ContactWithFriends {
  statusRef?: StatusLite | null;
  leadScore: number;
  hasZalo: boolean | null;
  zaloGlobalId?: string | null;
  zaloUsername?: string | null;
  friends?: FriendLite[];
}

export interface AggregateDisplay {
  displayStatus: StatusLite | null;
  displayLeadScore: number;
  displayHasZalo: boolean | null;
  childrenCount: number; // = friends.length (per-pair = "con")
  // Globally-unique identifiers — aggregate từ Friend rows:
  //  null khi không có data hoặc khác nhau giữa Friend (đa Zalo identity);
  //  string khi tất cả Friend agree (single common identity).
  // distinctGlobalIdCount > 1 → KH Cha gom nhiều Zalo identity → hiển thị "đa".
  aggregateZaloGlobalId: string | null;
  aggregateZaloUsername: string | null;
  distinctGlobalIdCount: number;
  distinctUsernameCount: number;
}

/**
 * Phase Contact Scope Hybrid 2026-05-27 — viewer-aware aggregation.
 * Pass `friendsOverride` để compute aggregate CHỈ từ Friend rows visible cho viewer
 * (vd: sale chỉ thấy nick mình → status/score/childrenCount tính qua subset).
 * Khi không truyền → fallback behavior cũ (toàn bộ friends).
 */
export function computeAggregateDisplay<T extends ContactWithFriends>(
  contact: T,
  friendsOverride?: FriendLite[],
): AggregateDisplay {
  const friends = friendsOverride ?? contact.friends ?? [];

  // Status cao nhất theo order — ưu tiên friends; fallback Contact.statusRef khi 0 friend.
  const friendStatuses = friends
    .map((f) => f.statusRef)
    .filter((s): s is StatusLite => s != null)
    .sort((a, b) => b.order - a.order);
  const displayStatus = friendStatuses[0] ?? contact.statusRef ?? null;

  // AVG leadScore của friends; fallback Contact.leadScore khi 0 friend.
  const displayLeadScore = friends.length > 0
    ? Math.round((friends.reduce((s, f) => s + (f.leadScore ?? 0), 0) / friends.length) * 10) / 10
    : (contact.leadScore ?? 0);

  // hasZalo: any friend tồn tại → KH có Zalo. Else giữ Contact.hasZalo.
  const displayHasZalo = friends.length > 0 ? true : contact.hasZalo;

  // Aggregate globalId/username: distinct giá trị từ Friend.
  // Fallback Contact field khi 0 friend (legacy data).
  const globalIds = new Set<string>();
  const usernames = new Set<string>();
  for (const f of friends) {
    if (f.zaloGlobalId) globalIds.add(f.zaloGlobalId);
    if (f.zaloUsername) usernames.add(f.zaloUsername);
  }
  let aggregateZaloGlobalId: string | null = null;
  let aggregateZaloUsername: string | null = null;
  if (globalIds.size === 1) aggregateZaloGlobalId = [...globalIds][0];
  else if (globalIds.size === 0 && contact.zaloGlobalId) aggregateZaloGlobalId = contact.zaloGlobalId;
  if (usernames.size === 1) aggregateZaloUsername = [...usernames][0];
  else if (usernames.size === 0 && contact.zaloUsername) aggregateZaloUsername = contact.zaloUsername;

  return {
    displayStatus,
    displayLeadScore,
    displayHasZalo,
    childrenCount: friends.length,
    aggregateZaloGlobalId,
    aggregateZaloUsername,
    distinctGlobalIdCount: globalIds.size,
    distinctUsernameCount: usernames.size,
  };
}

/**
 * Phase Contact Scope Hybrid 2026-05-27 — viewer-aware last preview.
 * Trả về override cho 8 field Contact.last*Preview/*Type/*MessageId/*At dựa trên
 * Friend rows mà viewer có quyền thấy (qua zalo-scope).
 * Caller spread vào response sau Contact base + computeAggregateDisplay để FE
 * không thấy preview của Friend row thuộc nick sale khác.
 *
 * visibleZaloAccountIds=null → admin/owner view (giữ Contact.last* aggregate global,
 * trả về undefined để caller không override).
 */
export interface ViewerPreviewOverride {
  lastInboundAt:        Date | string | null;
  lastInboundPreview:   string | null;
  lastInboundType:      string | null;
  lastInboundMessageId: string | null;
  lastOutboundAt:       Date | string | null;
  lastOutboundPreview:  string | null;
  lastOutboundType:     string | null;
  lastOutboundMessageId: string | null;
}

export function computeViewerPreview(
  contact: { friends?: FriendLite[] },
  visibleZaloAccountIds: Set<string> | null,
): ViewerPreviewOverride | null {
  if (visibleZaloAccountIds === null) return null; // admin → giữ aggregate global
  const visible = (contact.friends ?? []).filter(
    (f) => f.zaloAccountId && visibleZaloAccountIds.has(f.zaloAccountId),
  );

  const toMs = (d: Date | string | null | undefined) =>
    d ? new Date(d as any).getTime() : 0;

  const inbound = visible
    .filter((f) => f.lastInboundAt)
    .sort((a, b) => toMs(b.lastInboundAt) - toMs(a.lastInboundAt))[0];
  const outbound = visible
    .filter((f) => f.lastOutboundAt)
    .sort((a, b) => toMs(b.lastOutboundAt) - toMs(a.lastOutboundAt))[0];

  return {
    lastInboundAt:        inbound?.lastInboundAt ?? null,
    lastInboundPreview:   inbound?.lastInboundPreview ?? null,
    lastInboundType:      inbound?.lastInboundType ?? null,
    lastInboundMessageId: inbound?.lastInboundMessageId ?? null,
    lastOutboundAt:        outbound?.lastOutboundAt ?? null,
    lastOutboundPreview:   outbound?.lastOutboundPreview ?? null,
    lastOutboundType:      outbound?.lastOutboundType ?? null,
    lastOutboundMessageId: outbound?.lastOutboundMessageId ?? null,
  };
}

/** Standard include shape cho Prisma query để feed computeAggregateDisplay.
 *  Friends include qua canonical FRIEND_INCLUDE (shared/friend-serializer.ts) để
 *  cùng shape với /friends-db. Friend columns trả full qua `include` (không select
 *  whitelist) — thêm field schema mới tự lan tới mọi endpoint. */
export const AGGREGATE_INCLUDE = {
  statusRef: { select: STATUS_LITE_SELECT },
  friends: {
    // FIX 4 nick-ghost (Anh chốt 2026-06-13): LỌC Friend thuộc thẻ ma. Trước: include
    // không có where → /contacts hiện cả Friend trỏ thẻ ma (3 "Evo Sport") + childrenCount
    // (=friends.length) thổi phồng badge "Cùng chăm". Lọc:
    //   • zaloAccount.archivedAt=null → ẩn Friend của nick đã xoá mềm / thẻ ma đã dọn.
    //   • relationshipKind != 'ghost' → ẩn dòng quan hệ ma (KH từng nhắn rồi huỷ kết bạn).
    // Tác dụng phụ tốt: childrenCount tự đúng lại. Lưu ý (Codex #6): khi friends=[] thì
    // displayHasZalo fallback về Contact.hasZalo (KHÔNG tự false) — hành vi đúng, giữ nguyên.
    where: {
      zaloAccount: { archivedAt: null },
      relationshipKind: { not: 'ghost' },
    },
    include: FRIEND_INCLUDE,
    orderBy: { lastInboundAt: { sort: 'desc', nulls: 'last' } },
  },
  // M55 2026-05-30: include ContactAccess để render counter "Cùng chăm" +
  // avatar stack cho KH no-Zalo (vốn không có Friend). Limit 10 để tránh bloat.
  contactAccess: {
    select: {
      role: true,
      source: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  },
} as const;
