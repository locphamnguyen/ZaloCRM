// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import axios from 'axios';
import { router } from '@/router/index';
import { useToast } from '@/composables/use-toast';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

// JWT interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // FIX 2026-06-09 (anh báo Nhận khách/Chấp nhận kết bạn/AI lịch hẹn lỗi
  // "Unsupported Media Type" 415): nhiều nút gọi api.post(url) KHÔNG truyền body.
  // axios khi data=undefined sẽ không gắn Content-Type → Fastify (có
  // @fastify/formbody) từ chối POST rỗng với 415. Đảm bảo mọi POST/PUT/PATCH
  // luôn có body tối thiểu {} + Content-Type JSON. Sửa 1 chỗ, fix mọi nút.
  const method = (config.method || 'get').toLowerCase();
  if (method === 'post' || method === 'put' || method === 'patch') {
    if (config.data === undefined || config.data === null) {
      config.data = {};
    }
    // FormData / Blob giữ nguyên Content-Type do axios tự set (multipart).
    const isFormLike =
      (typeof FormData !== 'undefined' && config.data instanceof FormData) ||
      (typeof Blob !== 'undefined' && config.data instanceof Blob);
    if (!isFormLike && !config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }
  }

  return config;
});

// Throttle 5xx toast — tránh spam khi nhiều request fail cùng lúc
let last5xxToastAt = 0;
const TOAST_5XX_THROTTLE_MS = 4000;

// Phase 2 token hardening 2026-06-08 — access token ngắn (15') hết hạn -> 401.
// Tự động xoay refresh token rồi retry request, SINGLE-FLIGHT: nhiều request 401
// đồng thời chỉ gọi /auth/refresh một lần, cùng chờ một promise.
let refreshPromise: Promise<string> | null = null;

export function clearAuthAndRedirect() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  const current = router.currentRoute.value;
  // Trang public (vd /appointments/action mở từ link Zalo khi chưa login) KHÔNG ép về /login.
  // Dùng window.location.pathname làm nguồn xác thực: lúc boot, layout 'default' (có
  // NotificationBell) render NHÁY trước khi router resolve meta.public → /notifications 401
  // → redirect oan. pathname có ngay từ đầu nên chặn được race này.
  const PUBLIC_PREFIXES = ['/appointments/action'];
  const livePath = (typeof window !== 'undefined' && window.location?.pathname) || current.path;
  if (current.meta?.public || PUBLIC_PREFIXES.some((p) => livePath.startsWith(p))) return;
  if (current.path !== '/login' && current.path !== '/setup') {
    router.replace('/login');
  }
}

async function runRefresh(): Promise<string> {
  const rt = localStorage.getItem('refreshToken');
  if (!rt) throw new Error('no refresh token');
  // axios "trần" (không qua interceptor) tránh đệ quy refresh.
  const res = await axios.post('/api/v1/auth/refresh', { refreshToken: rt });
  localStorage.setItem('token', res.data.token);
  localStorage.setItem('refreshToken', res.data.refreshToken);
  return res.data.token as string;
}

// FIX socket-chết v2 2026-06-15 — single-flight refresh DÙNG CHUNG cho cả HTTP
// interceptor LẪN 5 socket realtime. BẮT BUỘC chỉ 1 refreshPromise duy nhất:
// nếu mỗi socket tự gọi /auth/refresh riêng với cùng refresh token cũ, backend
// (refresh-token rotation) tưởng TRỘM token → thu hồi cả họ token → ĐÁ user ra
// login đột ngột. Đây là điểm bảo mật /security-review chặn lại.
//
// Khóa CROSS-TAB qua localStorage: in-memory refreshPromise CHỈ dedupe trong 1 tab.
// Nhiều tab (tab nền thức dậy muộn >20s cửa-ân-hạn của BE) vẫn có thể replay RT cũ
// → revokeFamily. Cờ refresh-in-progress + thời điểm giúp tab khác CHỜ thay vì tự
// refresh song song. Không phải mutex tuyệt đối (localStorage không atomic) nhưng
// thu hẹp cửa sổ va chạm xuống mức an toàn cùng với grace 20s phía BE.
const REFRESH_LOCK_KEY = 'auth:refresh-in-progress';
const REFRESH_LOCK_TTL_MS = 10_000;

function peerRefreshInFlight(): boolean {
  const raw = localStorage.getItem(REFRESH_LOCK_KEY);
  if (!raw) return false;
  const startedAt = Number(raw);
  if (!Number.isFinite(startedAt)) return false;
  // Lock cũ hơn TTL coi như chết (tab kia crash giữa chừng) → bỏ qua.
  return Date.now() - startedAt < REFRESH_LOCK_TTL_MS;
}

/**
 * ensureFreshToken — refresh access token, SINGLE-FLIGHT toàn cục.
 * HTTP interceptor và mọi socket handler PHẢI đi qua đây, KHÔNG gọi runRefresh trực tiếp.
 * Trả access token mới. Throw nếu refresh thất bại (RT hết hạn/bị thu hồi).
 */
export async function ensureFreshToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    // Tab khác đang refresh → chờ nó ghi token mới vào localStorage thay vì tự refresh
    // song song (tránh replay RT cũ → revokeFamily). Poll ngắn token đổi.
    if (peerRefreshInFlight()) {
      const before = localStorage.getItem('token');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const now = localStorage.getItem('token');
        if (now && now !== before) return now; // tab kia đã refresh xong
        if (!peerRefreshInFlight()) break;      // lock nhả mà token không đổi → tự refresh
      }
    }
    localStorage.setItem(REFRESH_LOCK_KEY, String(Date.now()));
    try {
      return await runRefresh();
    } finally {
      localStorage.removeItem(REFRESH_LOCK_KEY);
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function isAuthEndpoint(url: string): boolean {
  return url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/setup');
}

// Response interceptor — global handle 401(refresh)/404/5xx
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const original = error.config ?? {};
    const url = original.url ?? '';

    // 401 + có refresh token + chưa retry + không phải auth endpoint -> thử xoay.
    if (
      status === 401 &&
      !original._retry &&
      !isAuthEndpoint(url) &&
      localStorage.getItem('refreshToken')
    ) {
      original._retry = true;
      try {
        // FIX socket-chết v2 — đi qua ensureFreshToken (single-flight CHUNG với socket),
        // không tự quản refreshPromise riêng nữa. Tránh HTTP + socket refresh song song.
        const newToken = await ensureFreshToken();
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original); // retry request gốc với token mới
      } catch {
        clearAuthAndRedirect();
        return Promise.reject(error);
      }
    }

    if (status === 401) {
      clearAuthAndRedirect();
    } else if (status === 403) {
      // RBAC enforce 2026-06-08 — backend từ chối quyền. Toast, KHÔNG redirect
      // (403 có thể đến từ 1 widget phụ, không nên giật cả trang).
      try {
        useToast().error(error.response?.data?.error ?? 'Bạn không có quyền thực hiện thao tác này');
      } catch (e) {
        console.error('[api] 403 toast unavailable', e);
      }
    } else if (status === 404) {
      // 404 thường là logic (entity không tồn tại) — chỉ log, không toast
      console.warn(`[api] 404 Not Found: ${url}`);
    } else if (typeof status === 'number' && status >= 500) {
      console.error(`[api] ${status} server error: ${url}`, error.response?.data);
      const now = Date.now();
      if (now - last5xxToastAt > TOAST_5XX_THROTTLE_MS) {
        last5xxToastAt = now;
        try {
          useToast().error('Máy chủ lỗi, vui lòng thử lại');
        } catch (e) {
          // Fallback nếu toast queue chưa sẵn sàng (vd lỗi trong app init)
          console.error('[api] toast unavailable', e);
        }
      }
    }
    return Promise.reject(error);
  },
);

export { api };
