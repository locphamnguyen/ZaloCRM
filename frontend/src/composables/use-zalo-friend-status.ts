// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-zalo-friend-status.ts — Phase C: Cross-check friend state via Zalo SDK.
 *
 * Khi mở conv → 1 lần check `getFriendRequestStatus(uid)`:
 *   - is_friend = 1   → confirm Friend.relationshipKind = 'friend'
 *   - is_requesting = 1 → 'pending_sent' (mình đã gửi mời)
 *   - is_requested = 1  → 'pending_received' (KH gửi mời mình)
 *   - else            → 'ghost' (đã unfriend HOẶC chưa từng)
 *
 * Cache 5 phút per (accountId, friendUid) để tránh spam khi sale switch conv nhanh.
 * Display: chỉ override DB state nếu Zalo trả KHÁC — nếu giống thì giữ DB.
 */
import { ref, watch, onUnmounted, onMounted } from 'vue';
import { api } from '@/api/index';

interface FriendStatus {
  isFriend: boolean;
  isRequesting: boolean; // KH gửi mời mình
  isRequested: boolean;  // Mình đã gửi mời
  fetchedAt: number;
}

// 60s — đủ ngắn để bắt KH-unfriend-inbound (Zalo SDK KHÔNG push REMOVE event khi
// KH unfriend trên Zalo app, chỉ getFriendRequestStatus cho biết is_friend=0).
// Đủ dài để không spam rate-limit (1 call/min/conv mở).
const CACHE_TTL_MS = 60_000;
// Auto-refresh interval khi conv đang mở — bắt inbound unfriend trong 30s
// (kết hợp với CACHE_TTL_MS=60s: lần fetch tiếp theo sẽ thực sự gọi SDK).
const AUTO_REFRESH_MS = 30_000;
// Socket update STICKY window — sau setStatus (socket event), auto-refresh KHÔNG
// được overwrite trong window này. Lý do: per-account UID — conv bind UID cũ
// (đã friend), socket emit pending_received cho UID mới khác. getFriendRequestStatus
// trên UID cũ vẫn trả is_friend=1 (stale, gây race condition override pending).
const SOCKET_STICKY_MS = 90_000;
const cache = new Map<string, FriendStatus>();

function cacheKey(accountId: string, friendUid: string) {
  return `${accountId}:${friendUid}`;
}

export function useZaloFriendStatus(
  accountId: () => string | null | undefined,
  friendUid: () => string | null | undefined,
) {
  const status = ref<FriendStatus | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  // Timestamp lần cuối setStatus (socket-driven). Auto-refresh skip nếu trong window.
  let lastSocketAt = 0;

  async function fetchStatus() {
    const acc = accountId();
    const uid = friendUid();
    if (!acc || !uid) {
      status.value = null;
      return;
    }

    // Cache check
    const k = cacheKey(acc, uid);
    const cached = cache.get(k);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      status.value = cached;
      return;
    }

    loading.value = true;
    error.value = null;
    try {
      // Backend route: /friends/requests/:userId/status → response { data: { is_friend, is_requested, is_requesting } }
      const { data: wrap } = await api.get(`/zalo-accounts/${acc}/friends/requests/${uid}/status`);
      const data = wrap?.data ?? wrap; // unwrap if wrapped
      const result: FriendStatus = {
        isFriend: data?.is_friend === 1,
        isRequesting: data?.is_requesting === 1,
        isRequested: data?.is_requested === 1,
        fetchedAt: Date.now(),
      };
      cache.set(k, result);
      status.value = result;
    } catch (err: any) {
      error.value = err?.response?.data?.error || 'fetch_failed';
      status.value = null;
    } finally {
      loading.value = false;
    }
  }

  watch([accountId, friendUid], fetchStatus, { immediate: true });

  // ── Auto-refresh khi conv mở ─────────────────────────────────────────────
  // Lý do: Zalo SDK KHÔNG push REMOVE event khi KH unfriend trên app.
  // Backend friend-sync-cron chỉ chạy 15min/lần. Để UI react "gần realtime"
  // cho inbound unfriend → polling getFriendRequestStatus mỗi 30s + refresh
  // ngay khi tab regain focus (visibilitychange).
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      // Skip nếu tab ẩn — đỡ tốn API
      if (typeof document !== 'undefined' && document.hidden) return;
      // Skip nếu socket vừa cập nhật state — tránh override pending_received bằng
      // stale getFriendRequestStatus của UID cũ (per-account UID race).
      if (Date.now() - lastSocketAt < SOCKET_STICKY_MS) return;
      const k = cacheKey(accountId() || '', friendUid() || '');
      cache.delete(k); // force refresh
      fetchStatus();
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function onVisibilityChange() {
    if (typeof document !== 'undefined' && !document.hidden) {
      // Tab regain focus → invalidate + refresh ngay, NHƯNG vẫn tôn trọng socket sticky
      if (Date.now() - lastSocketAt < SOCKET_STICKY_MS) return;
      const k = cacheKey(accountId() || '', friendUid() || '');
      cache.delete(k);
      fetchStatus();
    }
  }

  onMounted(() => {
    startAutoRefresh();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  });

  onUnmounted(() => {
    stopAutoRefresh();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    // Cache shared across components — không clear
  });

  /**
   * Manually set status (sau action như accept/reject/cancel). Update cả local ref +
   * shared cache để mọi component khác trên cùng (accountId, uid) cũng thấy state mới.
   */
  function setStatus(s: Partial<Omit<FriendStatus, 'fetchedAt'>>) {
    const acc = accountId();
    const uid = friendUid();
    if (!acc || !uid) return;
    const next: FriendStatus = {
      isFriend: s.isFriend ?? false,
      isRequesting: s.isRequesting ?? false,
      isRequested: s.isRequested ?? false,
      fetchedAt: Date.now(),
    };
    cache.set(cacheKey(acc, uid), next);
    status.value = next;
    lastSocketAt = Date.now(); // Mark sticky window — block auto-refresh override
  }

  /** Clear cache cho cặp (accountId, uid) hiện tại để refresh lấy fresh data. */
  function invalidate() {
    const acc = accountId();
    const uid = friendUid();
    if (!acc || !uid) return;
    cache.delete(cacheKey(acc, uid));
    status.value = null;
  }

  return { status, loading, error, refresh: fetchStatus, setStatus, invalidate };
}
