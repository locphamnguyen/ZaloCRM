// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * security-audit.ts — Phase 3 (Bảo mật xác thực 2026-06-08)
 *
 * Ghi security-event vào ActivityLog (category='security'). Hai mức (T2-A):
 *   - auditSecurityAsync   : fire-and-forget (login_success, logout, refresh_rotate)
 *                            — không chặn response, mất log khi crash chấp nhận được.
 *   - auditSecurityCritical: AWAIT + durable (refresh_reuse, password_change,
 *                            grant_change, token_revoke) — bằng chứng quan trọng,
 *                            KHÔNG được mất; lỗi ghi -> log error rõ ràng.
 *
 * Chạy qua runSystemQuery để không vướng tenant-guard (audit có thể chạy ngoài
 * request context, vd reuse-detection trong service). orgId resolve từ userId
 * nếu caller không truyền sẵn.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';

export type SecurityAction =
  | 'login_success'
  | 'logout'
  | 'refresh_rotate'
  | 'refresh_reuse'
  | 'password_change'
  | 'grant_change'
  | 'token_revoke';

export interface SecurityAuditInput {
  action: SecurityAction;
  /** orgId nếu biết sẵn (login đã có payload). Nếu thiếu -> resolve từ userId. */
  orgId?: string;
  userId: string;
  details?: Record<string, unknown>;
}

async function resolveOrgId(input: SecurityAuditInput): Promise<string | null> {
  if (input.orgId) return input.orgId;
  const user = await runSystemQuery(() =>
    prisma.user.findUnique({ where: { id: input.userId }, select: { orgId: true } }),
  );
  return user?.orgId ?? null;
}

function writeSecurityLog(orgId: string, input: SecurityAuditInput) {
  return prisma.activityLog.create({
    data: {
      orgId,
      userId: input.userId,
      actorType: 'user',
      category: 'security',
      action: input.action,
      details: (input.details ?? {}) as object,
    },
  });
}

/**
 * Fire-and-forget — login_success / logout / refresh_rotate. Không await ở caller.
 * Create bọc trong runSystemQuery để qua tenant-guard (login/logout chạy ngoài
 * request context). Lỗi -> log warn, không throw.
 */
export function auditSecurityAsync(input: SecurityAuditInput): void {
  void (async () => {
    try {
      const orgId = await resolveOrgId(input);
      if (!orgId) return;
      await runSystemQuery(() => writeSecurityLog(orgId, input));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[security-audit] async "${input.action}" failed (user=${input.userId}): ${msg}`);
    }
  })();
}

/** Awaited durable — refresh_reuse / password_change / grant_change / token_revoke. */
export async function auditSecurityCritical(input: SecurityAuditInput): Promise<void> {
  try {
    const orgId = await resolveOrgId(input);
    if (!orgId) {
      logger.error(`[security-audit] CRITICAL "${input.action}" không resolve được orgId (user=${input.userId})`);
      return;
    }
    await runSystemQuery(() => writeSecurityLog(orgId, input));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[security-audit] CRITICAL "${input.action}" GHI THẤT BẠI (user=${input.userId}): ${msg}`);
  }
}
