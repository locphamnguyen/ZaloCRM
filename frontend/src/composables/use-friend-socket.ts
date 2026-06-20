// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-friend-socket.ts — Subscribe Socket.IO `friend:updated` events từ backend.
 *
 * Backend emit khi:
 *  - friend_event listener xử lý (state change từ Zalo realtime)
 *  - applyFriendAggregate (tin nhắn mới → đổi displayName/avatar/relationshipKind)
 *  - friend-sync-service diff-then-emit (cron 15min, on-connect, manual sync)
 *
 * FE consume:
 *  - FriendsView: mutate row in friendsDb cache → instant cell update
 *  - ContactsView: mutate row in friendshipCache[contactId] (chỉ khi đã expand)
 *
 * Lifecycle: caller pass handler vào onFriendUpdated, composable manage subscribe
 * + cleanup on unmount tránh leak. Multiple subscribers share 1 underlying socket
 * (managed via socket.io-client default single instance).
 */
import { type Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';
import { onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

export interface FriendUpdatedPayload {
  friendId: string;
  contactId: string;
  zaloAccountId: string;
  /** Per-nick UID — FE phân biệt nhiều Friend rows cùng nick (per-account UID rule). */
  zaloUidInNick?: string;
  /** Subset fields đã đổi — merge vào row trong cache để live update. */
  patch: Record<string, unknown>;
}

let socket: Socket | null = null;
let joinedOrgId: string | null = null;

/**
 * B2 fix — Lazy init + auto-join org room.
 * Backend emit `io.to('org:${orgId}').emit(...)` → client phải `socket.emit('org:join')`
 * để được vào room. Trước đây composable chỉ register handler không join room → no-op
 * (Codex flagged: live update broken cho normal users).
 *
 * Pattern: emit ngay khi connect + re-emit trên reconnect (network blip).
 */
function ensureSocket(): Socket {
  if (!socket) {
    socket = createAppSocket();

    // Auto re-join org room mỗi khi socket connect (init + reconnect)
    socket.on('connect', () => {
      const auth = useAuthStore();
      const orgId = auth.user?.orgId;
      if (orgId) {
        socket!.emit('org:join', { orgId });
        joinedOrgId = orgId;
      }
    });
  }
  // Trường hợp socket đã connect rồi (composable thứ 2 mount sau) — join ngay
  if (socket.connected && !joinedOrgId) {
    const auth = useAuthStore();
    const orgId = auth.user?.orgId;
    if (orgId) {
      socket.emit('org:join', { orgId });
      joinedOrgId = orgId;
    }
  }
  return socket;
}

/**
 * Subscribe 'friend:updated'. Handler được gọi mỗi khi backend emit.
 * Tự động unsubscribe khi component unmount.
 */
export function useFriendSocket(handler: (payload: FriendUpdatedPayload) => void): void {
  const wrappedHandler = (payload: FriendUpdatedPayload) => {
    try {
      handler(payload);
    } catch (err) {
      console.error('[use-friend-socket] handler threw:', err);
    }
  };

  onMounted(() => {
    const s = ensureSocket();
    s.on('friend:updated', wrappedHandler);
  });

  onUnmounted(() => {
    if (socket) {
      socket.off('friend:updated', wrappedHandler);
    }
  });
}

/** Test helper — không dùng trong code production. */
export function _resetSocketForTest(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    joinedOrgId = null;
  }
}
