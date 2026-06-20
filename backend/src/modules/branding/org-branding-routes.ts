// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/*
 * org-branding-routes.ts — Public (PRE-AUTH) org branding for the login page.
 *
 * GET /api/v1/public/org-branding
 *   → { logoUrl, name, slogan, copyright, emailDomain }
 *
 * Trang /login chạy TRƯỚC khi đăng nhập nên không có JWT → không gọi được
 * /api/v1/organization (cần auth). Endpoint này công khai, CHỈ trả 5 trường
 * branding an toàn (allowlist tường minh), không lộ bất kỳ dữ liệu nhạy cảm nào.
 *
 * Tenancy: hệ thống đa tổ chức (mọi route khác dùng where:{id:user.orgId}),
 * nhưng pre-auth không biết orgId → resolve bằng org ĐẦU TIÊN theo createdAt
 * (giả định "1 tổ chức / 1 lần cài" — đúng với bản tự host private-hs).
 * Khi đa tổ chức thật, đổi sang resolve theo request host (xem plan E1-B).
 *
 * Chưa có org nào (cài lần đầu) → trả defaults 200 (KHÔNG 404/500) để login
 * vẫn render được. Front-end còn 1 lớp fallback hardcode riêng (D4-A).
 *
 * Rate-limit: global limiter (app.ts) đã key theo IP cho request thiếu token
 * (keyGenerator → `ip:`), nên route này được bảo vệ sẵn — không cần limiter cục bộ.
 * Cache-Control 60s giảm tải Postgres cho lượt mở trang login lặp lại.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

// Giá trị mặc định khi chưa có org / trường null. Trùng với hardcode hiện tại
// trên LoginView để trải nghiệm nhất quán dù endpoint trả defaults.
const DEFAULTS = {
  logoUrl: null as string | null,
  name: 'HS Holding',
  slogan: 'Bền vững · Trường tồn',
  copyright: `© ${new Date().getFullYear()} HS Holding`,
  emailDomain: null as string | null,
};

// Cache trong RAM 60s — endpoint công khai (pre-auth) bị mỗi lượt mở /login gọi,
// kẻ xấu có thể spam (giả X-Forwarded-File để né rate-limit). Cache khiến request
// lặp KHÔNG đụng Postgres → chặn "DB amplifier" bất kể hạ tầng proxy (review #8),
// đồng thời tăng tốc trang login. Lỗi DB không cache (để tự hồi khi DB sống lại).
const CACHE_TTL_MS = 60_000;
let cache: { at: number; data: Record<string, unknown> } | null = null;

// Cho test reset giữa các case (cache là state cấp module).
export function resetOrgBrandingCache(): void {
  cache = null;
}

export async function orgBrandingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/public/org-branding', async (_request, reply: FastifyReply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) return cache.data;
    try {
      const org = await prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        // Allowlist tường minh — chỉ 5 trường branding, không select gì khác.
        select: { name: true, logoUrl: true, slogan: true, copyright: true, emailDomain: true },
      });
      // Chưa có org (cài lần đầu) → defaults đẹp để login không trống trơn.
      // Org đã tồn tại → trả ĐÚNG giá trị admin cấu hình. KHÔNG nhồi default cho
      // từng trường: nếu admin để slogan/copyright trống thì login ẩn luôn, tránh
      // "leak" chữ mặc định (vd vẫn hiện "Bền vững · Trường tồn" dù đã xoá).
      // Riêng name luôn có (cột NOT NULL) → fallback chỉ phòng chuỗi rỗng.
      const data = org
        ? {
            logoUrl: org.logoUrl ?? null,
            name: org.name?.trim() || DEFAULTS.name,
            slogan: org.slogan ?? null,
            copyright: org.copyright ?? null,
            emailDomain: org.emailDomain ?? null,
          }
        : DEFAULTS;
      cache = { at: now, data };
      return data;
    } catch {
      // Lỗi DB không được làm vỡ trang login → trả defaults (KHÔNG cache lỗi).
      return DEFAULTS;
    }
  });
}
