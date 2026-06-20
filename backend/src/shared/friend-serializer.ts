// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * friend-serializer.ts — Canonical Prisma include + DTO transform cho Friend.
 *
 * Single source of truth cho mọi endpoint trả Friend row:
 *  - /friends-db (Bạn bè Zalo tab) → FRIEND_INCLUDE_WITH_CONTACT (flat per-pair, cần Contact metadata)
 *  - /contacts/:id (KH Cha expand) → FRIEND_INCLUDE (đã có Contact parent, không lặp)
 *  - friend-sync-service (emit socket) → FRIEND_INCLUDE
 *
 * Trước đây 2 endpoint dùng 2 include shape khác nhau → drift risk (vd crmTagsPerNick
 * có ở /contacts include nhưng thiếu ở /friends-db). Module này khoá lại 1 shape.
 *
 * Design choice: dùng `include` thay vì `select` cho Friend — trả full columns của
 * Friend (~30 fields). Khi thêm field mới vào schema → tự động xuất hiện ở mọi
 * endpoint. Tránh whitelist drift của pattern cũ.
 */
import type { Prisma } from '@prisma/client';

// ── Lite selects cho relation embedded ─────────────────────────────────────

/** Status (Trạng thái KH dynamic) — minimal fields cho UI chip. */
export const STATUS_LITE_SELECT = {
  id: true,
  name: true,
  order: true,
  color: true,
  isTerminal: true,
} as const satisfies Prisma.StatusSelect;

/** ZaloAccount nick CRM — fields cần cho FriendsView row + ContactsView child row.
 *  Union của 2 endpoint cũ: AGGREGATE_INCLUDE (full với owner) + /friends-db (no owner).
 *  Lấy union để FE dùng `zaloAccount.owner?.fullName` ở 1 chỗ. */
export const ZALO_ACCOUNT_LITE_SELECT = {
  id: true,
  displayName: true,
  phone: true,
  zaloUid: true,
  avatarUrl: true,
  // PRIVACY 2026-06-11: BẮT BUỘC có để redactFriend quyết định blur. Thiếu 2 field
  // này thì dù gọi redactFriend cũng không chặn được (audit H11). Fail-closed:
  // redactFriend mặc định redact nếu privacyMode undefined.
  privacyMode: true,
  ownerUserId: true,
  owner: { select: { id: true, fullName: true } },
} as const satisfies Prisma.ZaloAccountSelect;

/** Contact (KH Cha) lite — chỉ dùng cho /friends-db và /friends-db/all-nicks
 *  vì các endpoint đó list flat Friend rows, FE cần KH metadata để render cell.
 *  /contacts/:id KHÔNG cần (Contact là parent của query). */
export const CONTACT_LITE_SELECT = {
  id: true,
  fullName: true,
  crmName: true,
  phone: true,
  email: true,
  avatarUrl: true,
  tags: true,
  leadScore: true,
  source: true,
  gender: true,
  status: true,
  province: true,
  district: true,
  birthYear: true,
} as const satisfies Prisma.ContactSelect;

// ── Canonical Friend includes ──────────────────────────────────────────────

/**
 * Friend với relations only (KHÔNG có Contact).
 * Dùng cho /contacts/:id (Contact là parent query, không lặp lại).
 * Cũng dùng cho computeAggregateDisplay trong contact-aggregate-display.ts.
 */
export const FRIEND_INCLUDE = {
  statusRef: { select: STATUS_LITE_SELECT },
  zaloAccount: { select: ZALO_ACCOUNT_LITE_SELECT },
} as const satisfies Prisma.FriendInclude;

/**
 * Friend với Contact relation kèm theo.
 * Dùng cho /friends-db và /friends-db/all-nicks — flat per-pair list,
 * FE cần Contact metadata (fullName, phone, ...) để hiển thị mỗi row.
 */
export const FRIEND_INCLUDE_WITH_CONTACT = {
  ...FRIEND_INCLUDE,
  contact: { select: CONTACT_LITE_SELECT },
} as const satisfies Prisma.FriendInclude;

// ── Inferred types từ Prisma generics ──────────────────────────────────────

/** Friend row với relations only (statusRef + zaloAccount). */
export type FriendRow = Prisma.FriendGetPayload<{
  include: typeof FRIEND_INCLUDE;
}>;

/** Friend row với Contact relation đi kèm. */
export type FriendRowWithContact = Prisma.FriendGetPayload<{
  include: typeof FRIEND_INCLUDE_WITH_CONTACT;
}>;

// ── DTO transform ──────────────────────────────────────────────────────────

/**
 * Transform Friend row → API DTO.
 *
 * Hiện tại là identity passthrough (Prisma row đã đúng shape cho FE).
 * Giữ hàm này làm seam để future thêm transform (parse JSON labels,
 * format timestamps, computed flags...) mà KHÔNG break consumers.
 *
 * Generic preserve relation shape: caller pass FriendRow → return FriendRow,
 * pass FriendRowWithContact → return FriendRowWithContact.
 */
export function toFriendDto<T extends FriendRow | FriendRowWithContact>(row: T): T {
  return row;
}

/**
 * Build socket emit payload cho 'friend:updated' event.
 * Caller xác định patch fields đã đổi → tránh emit khi không có gì thay đổi.
 *
 * Shape khớp với FE composable use-friend-socket.ts:
 *   { friendId, contactId, zaloAccountId, patch }
 * FE merge patch vào row trong cache mà không refetch.
 */
export interface FriendUpdatedPayload {
  friendId: string;
  contactId: string;
  zaloAccountId: string;
  /** Per-nick UID — FE filter để phân biệt nhiều Friend rows cùng nick (per-account UID). */
  zaloUidInNick?: string;
  /** Subset fields đã đổi. Key/value khớp Prisma.FriendUpdateInput shape. */
  patch: Record<string, unknown>;
}

export function buildFriendUpdatedPayload(args: {
  friendId: string;
  contactId: string;
  zaloAccountId: string;
  zaloUidInNick?: string;
  patch: Record<string, unknown>;
}): FriendUpdatedPayload {
  return {
    friendId: args.friendId,
    contactId: args.contactId,
    zaloAccountId: args.zaloAccountId,
    zaloUidInNick: args.zaloUidInNick,
    patch: args.patch,
  };
}
