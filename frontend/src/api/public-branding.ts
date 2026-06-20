// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/*
 * public-branding.ts — Lấy branding tổ chức cho trang /login (PRE-AUTH).
 *
 * Dùng axios "trần" (KHÔNG qua `api` client) vì:
 *   - trang login chạy trước đăng nhập, không có/không nên gắn JWT;
 *   - `api` có interceptor 401 → refresh/redirect/toast, sẽ gây hành vi lạ
 *     (redirect, toast lỗi) nếu localStorage còn token cũ.
 *
 * Lỗi mạng/endpoint → trả null; caller (LoginView) tự fallback về mặc định.
 */
import axios from 'axios';

export interface OrgBranding {
  logoUrl: string | null;
  name: string;
  slogan: string;
  copyright: string;
  emailDomain: string | null;
}

export async function fetchPublicBranding(): Promise<OrgBranding | null> {
  try {
    const res = await axios.get<OrgBranding>('/api/v1/public/org-branding', { timeout: 5000 });
    return res.data;
  } catch {
    return null;
  }
}
