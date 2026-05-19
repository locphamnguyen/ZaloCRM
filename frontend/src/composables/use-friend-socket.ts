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
import { io, type Socket } from 'socket.io-client';
import { onMounted, onUnmounted } from 'vue';

export interface FriendUpdatedPayload {
  friendId: string;
  contactId: string;
  zaloAccountId: string;
  /** Subset fields đã đổi — merge vào row trong cache để live update. */
  patch: Record<string, unknown>;
}

let socket: Socket | null = null;

/** Lazy init — chỉ kết nối khi composable đầu tiên gọi. */
function ensureSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ['websocket', 'polling'] });
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
  }
}
