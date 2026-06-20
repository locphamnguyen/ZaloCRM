// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * tenant-guard.ts — Phase 1a (Bảo mật xác thực 2026-06-07)
 *
 * Defense-in-depth tầng ứng dụng cho cô lập tenant. Biên giới CHÍNH là Postgres
 * RLS (migration riêng); guard này bắt sớm lỗi lập trình: org-scoped query chạy
 * NGOÀI mọi tenant context (quên withTenant ở worker / route chưa qua auth).
 *
 *   off     → no-op (mặc định, zero risk)
 *   warn    → logger.warn (phát hiện call-site thiếu context trên staging)
 *   enforce → throw (chặn cứng, bật sau khi warn sạch + RLS apply)
 *
 * Có tenant context (kể cả runSystemQuery bypass) → pass. Chỉ thiếu hẳn context
 * mới kích hoạt — vì withTenant/enterTenantContext luôn set orgId.
 */
import { ORG_SCOPED_MODELS } from './org-scoped-models.js';
import { getTenantContext } from './tenant-context.js';
import { config } from '../../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Kiểm tra một thao tác Prisma có chạy trong tenant context hợp lệ không.
 * @param model Tên model PascalCase (tham số `model` của Prisma $allOperations).
 * @param operation Tên operation (để log rõ ràng).
 */
export function checkTenantGuard(model: string | undefined, operation = ''): void {
  const mode = config.tenantGuardMode;
  if (mode === 'off') return;
  if (!model || !ORG_SCOPED_MODELS.has(model)) return;

  // Có context (request authMiddleware, withTenant, hoặc runSystemQuery bypass) → ok.
  if (getTenantContext()) return;

  const msg =
    `[tenant-guard] ${model}.${operation} chạy NGOÀI tenant context. ` +
    `Worker/cron phải bọc withTenant(orgId, fn); auth-path dùng runSystemQuery().`;

  if (mode === 'enforce') {
    throw new Error(msg);
  }
  logger.warn(msg);
}
