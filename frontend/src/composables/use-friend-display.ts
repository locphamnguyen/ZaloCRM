// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-friend-display.ts — Shared fallback chain cho tên KH hiển thị trên UI.
 *
 * Vấn đề: code cũ chỉ dùng `contact.crmName || contact.fullName` → khi Contact stub
 * có fullName='Unknown' (tạo bởi resolveContact trong friend-event-handler khi event
 * đến trước message, không có name payload), popup/chat/conv list hiện "Unknown"
 * dù Friend đã có zaloDisplayName từ Zalo SDK.
 *
 * Fix: chain ưu tiên đúng + treat 'Unknown' literal như không có name.
 *   1. Contact.crmName    — sale tự đặt tên KH (cấp KH chung)
 *   2. Contact.fullName   — tên chính thức KH (nếu ≠ 'Unknown')
 *   3. Friend.aliasInNick — tên gợi nhớ trên Zalo (per-nick)
 *   4. Friend.zaloDisplayName — tên Zalo của KH nhìn từ nick này
 *   5. Fallback: 'KH-XXXX' với UID 4 ký tự cuối, hoặc 'Khách hàng' nếu cũng không có UID
 */

interface FriendLike {
  aliasInNick?: string | null;
  zaloDisplayName?: string | null;
  zaloUidInNick?: string | null;
  contact?: {
    crmName?: string | null;
    fullName?: string | null;
  } | null;
}

function isUsableName(s: string | null | undefined): s is string {
  return !!s && s.trim().length > 0 && s.trim().toLowerCase() !== 'unknown';
}

/** Tên hiển thị KH chính (tên KH Cha). */
export function displayCustomerName(f: FriendLike | null | undefined, fallbackEmpty = 'Khách hàng'): string {
  if (!f) return fallbackEmpty;
  const c = f.contact;
  if (c) {
    if (isUsableName(c.crmName)) return c.crmName!;
    if (isUsableName(c.fullName)) return c.fullName!;
  }
  if (isUsableName(f.zaloDisplayName)) return f.zaloDisplayName!;
  if (isUsableName(f.aliasInNick)) return f.aliasInNick!;
  // UID fallback: cho power user / debug — hiển thị "KH-XXXX" (4 ký tự cuối)
  if (f.zaloUidInNick) return `KH-${f.zaloUidInNick.slice(-4)}`;
  return fallbackEmpty;
}

/** Initials 2 ký tự cho avatar fallback. */
export function customerInitials(f: FriendLike | null | undefined): string {
  const name = displayCustomerName(f, '?');
  if (name === '?' || name.startsWith('KH-')) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}
