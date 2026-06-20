// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * tenant-context.ts — Phase 0 Gateway (Bảo mật xác thực 2026-06-07)
 *
 * AsyncLocalStorage mang theo tenant context (orgId/userId/role) xuyên suốt
 * một request HTTP hoặc một job worker, để tầng dữ liệu (Phase 1: Prisma
 * tenant-guard + Postgres RLS) tự lấy orgId mà KHÔNG cần truyền tay qua mọi
 * hàm.
 *
 *   HTTP request:  authMiddleware → enterWith(ctx) → handler chạy trong ctx
 *   Worker/cron:   withTenant(orgId, fn) → fn chạy trong ctx
 *
 * Phase 0 chỉ CUNG CẤP context, CHƯA enforce. Phase 1 mới bật fail-loud +
 * RLS dựa trên context này. Tách 2 bước để không sập worker khi flip enforce.
 *
 *   ┌─────────────┐   enterWith / withTenant   ┌──────────────────┐
 *   │ auth / job  │ ─────────────────────────▶ │ AsyncLocalStorage │
 *   └─────────────┘                            └────────┬─────────┘
 *                                                       │ getStore()
 *                                              ┌────────▼─────────┐
 *                                              │ Prisma extension │ (Phase 1)
 *                                              │ + Postgres RLS   │
 *                                              └──────────────────┘
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  /** Org (tenant) hiện hành — biên giới cô lập dữ liệu. */
  orgId: string;
  /** User thực hiện request; 'system' cho job worker không gắn user. */
  userId: string;
  /** Role của actor; 'system' cho job nội bộ. */
  role: string;
  /**
   * Cho phép bỏ qua tenant-guard CHO MỘT SỐ truy vấn cross-org hợp lệ
   * (vd: job toàn cục, lookup theo phone xuyên org đã được kiểm soát).
   * Mặc định false. Đặt true PHẢI có lý do rõ ràng tại call-site.
   */
  bypassTenantGuard?: boolean;
  /**
   * Phase 1a RLS (Giai đoạn 0): đánh dấu rằng `app.current_org` (hoặc bypass) ĐÃ được
   * set trên connection của transaction hiện hành (qua tenantTransaction). Khi true,
   * Prisma RLS-setconfig extension KHÔNG wrap thêm $transaction (tránh lồng transaction).
   * Chỉ tenantTransaction() đặt cờ này.
   */
  rlsConfigApplied?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Gắn context cho phần async hiện tại trở đi (dùng trong Fastify hook —
 * enterWith persist suốt vòng đời request trong cùng async context).
 */
export function enterTenantContext(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

/** Lấy context hiện hành, undefined nếu đang chạy ngoài mọi scope. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Lấy context, THROW nếu thiếu. Phase 1 dùng trong tenant-guard để fail-loud
 * khi một org-scoped query chạy ngoài mọi scope (request hoặc withTenant).
 */
export function requireTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      '[tenant] Không có tenant context. Org-scoped query phải chạy trong request ' +
        '(authMiddleware) hoặc withTenant(orgId, fn).',
    );
  }
  return ctx;
}

/**
 * Chạy `fn` trong một tenant scope tường minh — dùng cho worker/cron/socket/
 * webhook chạy NGOÀI request HTTP. Đây là API bắt buộc để Phase 1 enforce an toàn.
 *
 * @example
 *   await withTenant(job.orgId, async () => {
 *     await prisma.contact.findMany();
 *   });
 */
export function withTenant<T>(
  orgId: string,
  fn: () => Promise<T>,
  opts?: { userId?: string; role?: string; bypassTenantGuard?: boolean },
): Promise<T> {
  return storage.run(
    {
      orgId,
      userId: opts?.userId ?? 'system',
      role: opts?.role ?? 'system',
      bypassTenantGuard: opts?.bypassTenantGuard ?? false,
    },
    fn,
  );
}

/**
 * Chạy `fn` ở chế độ SYSTEM bypass tenant-guard — CHỈ cho query hợp lệ chạy
 * trước/ngoài tenant context: auth lookup (login/verify token tìm user theo
 * email/id KHI CHƯA biết org), migration, healthcheck cross-org có kiểm soát.
 *
 * ⚠️ KHÔNG dùng cho business logic — đó là đường vòng qua cô lập tenant.
 */
export function runSystemQuery<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(
    { orgId: '*', userId: 'system', role: 'system', bypassTenantGuard: true },
    fn,
  );
}

/**
 * Phase 1a RLS (Giai đoạn 0): chạy `fn` trong frame con kế thừa context hiện hành
 * nhưng đánh dấu `rlsConfigApplied = true`. Dùng BÊN TRONG tenantTransaction() sau khi
 * đã SET LOCAL app.current_org trên tx — để các op Prisma lồng bên trong KHÔNG bị
 * RLS-setconfig extension wrap thêm $transaction (tránh lồng transaction → lỗi).
 * Không có context → chạy thẳng (no-op).
 */
export function runWithRlsApplied<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = storage.getStore();
  if (!ctx) return fn();
  return storage.run({ ...ctx, rlsConfigApplied: true }, fn);
}
