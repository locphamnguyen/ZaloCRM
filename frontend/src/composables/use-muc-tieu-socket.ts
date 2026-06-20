// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-muc-tieu-socket.ts — Sprint v3 Tuần 3 Row 2.2 (2026-06-03)
 *
 * Subscribe Socket.IO event `friend-invite:claimed` để Mục tiêu Detail dashboard
 * surface UI realtime "KH X → nick Y đang xử lý" — sale KHÔNG nhìn nhầm nick khác
 * chiếm trùng.
 *
 * Backend emit ở `nick-worker.ts:794` org-scoped sau khi nick claim entry và
 * gửi friend-request thành công (Phase 3 success).
 *
 * FE consume: MucTieuDetailView.vue gọi useMucTieuSocket(handler), filter
 * payload.triggerId === currentTriggerId trong handler để bỏ qua mục tiêu khác.
 *
 * Share underlying socket với use-friend-socket.ts qua socket.io-client default singleton.
 */
import { type Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';
import { onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

export interface FriendInviteClaimedPayload {
  entryId: string;
  contactId: string;
  contactName: string;
  nickId: string;
  nickName: string;
  claimedAt: string; // ISO 8601
  triggerId: string;
  rowIndex: number;
}

let socket: Socket | null = null;
let joinedOrgId: string | null = null;

function ensureSocket(): Socket {
  if (!socket) {
    socket = createAppSocket();
    socket.on('connect', () => {
      const auth = useAuthStore();
      const orgId = auth.user?.orgId;
      if (orgId) {
        socket!.emit('org:join', { orgId });
        joinedOrgId = orgId;
      }
    });
  }
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

export function useMucTieuSocket(handler: (payload: FriendInviteClaimedPayload) => void): void {
  const wrappedHandler = (payload: FriendInviteClaimedPayload) => {
    try {
      handler(payload);
    } catch (err) {
      console.error('[use-muc-tieu-socket] handler threw:', err);
    }
  };

  onMounted(() => {
    const s = ensureSocket();
    s.on('friend-invite:claimed', wrappedHandler);
  });

  onUnmounted(() => {
    if (socket) {
      socket.off('friend-invite:claimed', wrappedHandler);
    }
  });
}
