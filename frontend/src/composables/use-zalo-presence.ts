// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-zalo-presence.ts — Phase A: Real-time Zalo online presence.
 *
 * Source of truth: backend endpoint `/zalo-accounts/:accountId/profile/last-online/:userId`
 * — wraps Zalo SDK `api.lastOnline()` với cache 30s server-side.
 *
 * Real-time updates: subscribe socket 'friend:presence' từ presence-service cron 60s.
 * Khi event tới, set lastOnline = now for friends in the online list.
 *
 * Privacy gate: nếu Zalo trả `show_online_status: false`, `showStatus = false` →
 * UI ẩn indicator hoàn toàn (KHÔNG hiển thị "Không rõ").
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import { type Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

interface PresenceState {
  /** Unix ms từ Zalo lastOnline. null = privacy off OR fetch failed */
  lastOnline: number | null;
  showStatus: boolean;
  isOnline: boolean;
  fetchedAt: number;
}

// Singleton socket — share với các composable khác (use-friend-socket pattern)
let socket: Socket | null = null;
let joinedOrgId: string | null = null;
const subscribers = new Map<string, (event: { accountId: string; onlines: string[]; at: number }) => void>();

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
    socket.on('friend:presence', (event: { accountId: string; onlines: string[]; at: number }) => {
      for (const cb of subscribers.values()) cb(event);
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

export function useZaloPresence(
  accountId: () => string | null | undefined,
  friendUid: () => string | null | undefined,
) {
  const state = ref<PresenceState | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchPresence() {
    const acc = accountId();
    const uid = friendUid();
    if (!acc || !uid) {
      state.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.get(`/zalo-accounts/${acc}/profile/last-online/${uid}`);
      state.value = {
        lastOnline: data.lastOnline,
        showStatus: data.showStatus,
        isOnline: data.isOnline,
        fetchedAt: data.fetchedAt,
      };
    } catch (err: any) {
      error.value = err?.response?.data?.error || 'fetch_failed';
      state.value = null;
    } finally {
      loading.value = false;
    }
  }

  // Re-fetch on accountId/friendUid change
  watch([accountId, friendUid], fetchPresence, { immediate: true });

  // Subscribe socket — when bulk presence event arrives, check if our friendUid is online
  ensureSocket();
  const subKey = `presence-${Math.random().toString(36).slice(2)}`;
  subscribers.set(subKey, (event) => {
    const acc = accountId();
    const uid = friendUid();
    if (!acc || !uid) return;
    if (event.accountId !== acc) return;
    if (event.onlines.includes(uid)) {
      // Friend is online RIGHT NOW — update state without re-fetch
      state.value = {
        lastOnline: event.at,
        showStatus: true,
        isOnline: true,
        fetchedAt: event.at,
      };
    }
  });

  onUnmounted(() => {
    subscribers.delete(subKey);
  });

  /** Computed label: "Vừa online", "Online Xp/h/d trước", "Đã ẩn", null */
  const label = computed<string | null>(() => {
    if (!state.value) return null;
    if (!state.value.showStatus) return null; // privacy — hide entirely
    if (state.value.lastOnline === null) return null;
    const mins = Math.floor((Date.now() - state.value.lastOnline) / 60_000);
    if (state.value.isOnline || mins < 5) return 'Online';
    if (mins < 60) return `Online ${mins}p trước`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Online ${hours}h trước`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Online ${days} ngày trước`;
    if (days < 365) return `Online ${Math.floor(days / 30)} tháng trước`;
    return `Offline lâu`;
  });

  /** Should the UI show ANY indicator? false when privacy off OR no data */
  const hasIndicator = computed(() => {
    return state.value !== null && state.value.showStatus;
  });

  const isOnline = computed(() => state.value?.isOnline ?? false);

  return { state, loading, error, label, hasIndicator, isOnline, refresh: fetchPresence };
}
