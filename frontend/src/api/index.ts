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

function clearAuthAndRedirect() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  const currentPath = router.currentRoute.value.path;
  if (currentPath !== '/login' && currentPath !== '/setup') {
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
        if (!refreshPromise) {
          refreshPromise = runRefresh().finally(() => {
            refreshPromise = null;
          });
        }
        const newToken = await refreshPromise;
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
