// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * socket.ts — Socket.IO client factory (Phase 1b auth 2026-06-07).
 *
 * Mọi composable tạo socket QUA đây để JWT được gắn vào handshake một chỗ
 * duy nhất (DRY). Token đọc động qua callback → khi reconnect lấy token mới
 * (quan trọng cho access token ngắn hạn + refresh rotation ở Phase 2).
 *
 * Backend (socket-auth.ts) verify token này và auto-join org room từ token,
 * nên FE KHÔNG cần emit('org:join') nữa.
 *
 * ── FIX socket-chết-treo-lâu v2 (2026-06-15) ──────────────────────────────
 * Bệnh: access token sống 15'. BE socket-auth.ts đặt expiryTimer → socket.disconnect(true)
 * đúng lúc token hết hạn → client nhận reason='io server disconnect' → socket-io CHẾT HẲN
 * MỘT LẦN, KHÔNG tự reconnect (theo spec socket.io-client). Trước đây KHÔNG composable nào
 * có handler disconnect/connect_error → cột 2 chat đứng im chờ vô hạn, tin mới không hiện.
 *
 * Cách chữa (đặt 1 chỗ ở ĐÂY → cả 5 socket: use-chat, use-friend, use-muc-tieu,
 * use-zalo-presence, use-zalo-accounts tự thừa hưởng):
 *   - disconnect('io server disconnect') = nhánh CHÍNH → ensureFreshToken() rồi socket.connect()
 *     (đọc lại token tươi qua callback auth bên dưới).
 *   - connect_error auth-class = nhánh PHỤ (reconnect-attempt fail vì token) → cùng xử lý qua bộ
 *     đếm retry chống hammer.
 *   - ensureFreshToken là single-flight CHUNG (api/index.ts) → chống nhiều socket refresh song song
 *     bị BE tưởng trộm token → thu hồi họ token → đá user ra login.
 *   - Giới hạn retry: nếu refresh-ok mà connect cứ fail (BE socket trục trặc / lệch giờ) thì dừng
 *     sau N lần, để badge "mất kết nối" hiện, KHÔNG đập /auth/refresh vô hạn.
 *   - onStatusChange callback → composable cập nhật badge realtime.
 */
import { io, type Socket } from 'socket.io-client';
import { ensureFreshToken, clearAuthAndRedirect } from '@/api/index';

export type SocketStatus = 'connected' | 'disconnected' | 'reconnecting';

export interface CreateSocketOpts {
  /** Báo trạng thái cho UI (badge "mất kết nối"). */
  onStatusChange?: (status: SocketStatus) => void;
  /** Gọi 1 lần khi reconnect THÀNH CÔNG sau 1 khoảng chết — dùng refetch bù tin lỡ. */
  onReconnect?: (downMs: number) => void;
}

// Chống hammer: tối đa N lần refresh-rồi-reconnect trong 1 cửa sổ trước khi bỏ cuộc.
const MAX_AUTH_RETRIES = 5;
const RETRY_WINDOW_MS = 60_000;
// Chỉ refetch bù tin nếu socket đã chết lâu hơn ngưỡng này (chống flapping).
const REFETCH_MIN_DOWN_MS = 3_000;

const AUTH_ERR_RE = /unauthorized|token_expired|legacy_token_rejected|invalid|jwt|auth/i;

export function createAppSocket(opts?: CreateSocketOpts): Socket {
  const socket = io({
    transports: ['websocket', 'polling'],
    auth: (cb: (data: { token: string }) => void) =>
      cb({ token: localStorage.getItem('token') ?? '' }),
  });

  // ── State cho recovery, đóng kín trong closure mỗi socket ──
  let authRetries = 0;
  let retryWindowStart = 0;
  let disconnectedAt = 0;
  let healing = false; // chống re-entrancy: 1 lần heal đang chạy thì không khởi thêm

  function noteRetry(): boolean {
    const now = Date.now();
    if (now - retryWindowStart > RETRY_WINDOW_MS) {
      retryWindowStart = now;
      authRetries = 0;
    }
    authRetries += 1;
    return authRetries <= MAX_AUTH_RETRIES;
  }

  // Heal: refresh token (single-flight chung) rồi connect lại. KHÔNG log err object
  // (chứa handshake.auth.token). Vượt ngưỡng retry → để badge hiện, socket-io tự backoff.
  async function healAuth() {
    if (healing) return;
    if (!noteRetry()) {
      opts?.onStatusChange?.('disconnected'); // hết lượt → đứng yên, badge hiện
      return;
    }
    healing = true;
    opts?.onStatusChange?.('reconnecting');
    try {
      await ensureFreshToken();
      if (!socket.active) socket.connect(); // guard !active chống đua với auto-reconnect của socket-io
    } catch {
      // refresh thất bại hẳn (RT hết hạn/bị thu hồi) → logout sạch (đã có ở interceptor HTTP).
      clearAuthAndRedirect();
    } finally {
      healing = false;
    }
  }

  socket.on('connect', () => {
    authRetries = 0;
    opts?.onStatusChange?.('connected');
    if (disconnectedAt > 0) {
      const downMs = Date.now() - disconnectedAt;
      disconnectedAt = 0;
      if (downMs >= REFETCH_MIN_DOWN_MS) opts?.onReconnect?.(downMs); // bù tin lỡ trong lúc chết
    }
  });

  socket.on('disconnect', (reason: string) => {
    if (disconnectedAt === 0) disconnectedAt = Date.now();
    opts?.onStatusChange?.('disconnected');
    // NHÁNH CHÍNH: server chủ động đá (token 15' hết hạn) → socket-io KHÔNG tự reconnect
    // → phải tự refresh + connect lại. Các reason khác (transport close, ping timeout...)
    // socket-io tự reconnect, KHÔNG can thiệp (tránh đua double-connect).
    if (reason === 'io server disconnect') {
      void healAuth();
    }
  });

  socket.on('connect_error', (err: Error) => {
    // NHÁNH PHỤ: reconnect-attempt thất bại vì token (chỉ match err.message — KHÔNG log err).
    if (AUTH_ERR_RE.test(err?.message ?? '')) {
      void healAuth();
    }
    // err mạng thuần → socket-io tự backoff, không làm gì.
  });

  return socket;
}
