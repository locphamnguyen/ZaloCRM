// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-pending-mutations.ts — Cross-component pending mutation registry.
 *
 * Vấn đề: MessageThread thực hiện optimistic mutation lên `props.conversation.friendship`.
 * Khi `fetchConversations()` chạy giữa lúc BE đang xử lý assign (1 friend update + sync ZaloLabel
 * có thể mất 50-500ms), response thay thế toàn bộ `conversations.value` array → optimistic
 * mutation trên object cũ bị mất → tag tạm thời biến mất khỏi UI ("flicker").
 *
 * Giải pháp: track pending mutations ở module level. fetchConversations apply pending mutations
 * lên response trước khi commit vào state. MessageThread đăng ký khi optimistic, clear khi BE
 * confirm hoặc rollback. TTL fallback 10s để tránh stuck nếu RPC hang.
 */

interface PendingTagEntry {
  tags: string[];
  expiresAt: number;
}

const TTL_MS = 10_000;
const pendingTagMutations = new Map<string, PendingTagEntry>();

function pruneExpired() {
  const now = Date.now();
  for (const [id, entry] of pendingTagMutations) {
    if (now > entry.expiresAt) pendingTagMutations.delete(id);
  }
}

/** Đăng ký optimistic mutation chờ BE confirm. Gọi NGAY khi user click. */
export function registerPendingTags(convId: string, tags: string[]): void {
  pendingTagMutations.set(convId, { tags: [...tags], expiresAt: Date.now() + TTL_MS });
}

/** Clear khi BE confirm thành công HOẶC rollback do fail. */
export function clearPendingTags(convId: string): void {
  pendingTagMutations.delete(convId);
}

/** Apply pending tags lên conversation list từ BE response.
 *  Mutate inline để giữ shape của response. */
export function applyPendingTags<T extends { id: string; friendship?: { crmTagsPerNick?: string[] } | null }>(convs: T[]): T[] {
  pruneExpired();
  if (pendingTagMutations.size === 0) return convs;
  for (const conv of convs) {
    const entry = pendingTagMutations.get(conv.id);
    if (entry && conv.friendship) {
      conv.friendship.crmTagsPerNick = [...entry.tags];
    }
  }
  return convs;
}
