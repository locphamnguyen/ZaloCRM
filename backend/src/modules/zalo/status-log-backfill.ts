// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * status-log-backfill.ts — Phase ZaloAccounts redesign 2026-05-22
 *
 * One-shot backfill: tạo 1 open record cho mỗi nick chưa có status log.
 *
 * Logic:
 *   - Nick có status='connected' + lastConnectedAt → open record (status='connected',
 *     startedAt=lastConnectedAt, endedAt=NULL, reason='login').
 *   - Nick có status='disconnected' / 'qr_pending' → open record với startedAt=createdAt
 *     hoặc lastConnectedAt nếu có (baseline coarse).
 *   - Nick đã có open record → skip (idempotent, chạy nhiều lần OK).
 *
 * Sau backfill, cron checkpoint sẽ reconcile bất kỳ drift nào trong tick tiếp theo (5p).
 *
 * Trigger: gọi 1 lần lúc deploy. Có thể expose qua admin route nếu cần re-run.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import type { ZaloStatus, StatusReason } from './status-log-service.js';

export async function backfillStatusLog(): Promise<{
  totalAccounts: number;
  backfilled: number;
  skipped: number;
}> {
  const accounts = await prisma.zaloAccount.findMany({
    select: { id: true, orgId: true, status: true, lastConnectedAt: true, createdAt: true },
  });

  let backfilled = 0;
  let skipped = 0;

  for (const acct of accounts) {
    // Idempotent: skip nếu đã có open record
    const existing = await prisma.zaloAccountStatusLog.findFirst({
      where: { accountId: acct.id, endedAt: null },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const logStatus = mapToLogStatus(acct.status);
    if (!logStatus) {
      skipped++;
      continue;
    }

    const startedAt = acct.lastConnectedAt ?? acct.createdAt;
    const reason: StatusReason = logStatus === 'connected' ? 'login' : 'crash_recovery';

    await prisma.zaloAccountStatusLog.create({
      data: {
        orgId: acct.orgId,
        accountId: acct.id,
        status: logStatus,
        startedAt,
        endedAt: null,
        reason,
      },
    });
    backfilled++;
  }

  logger.info(
    `[status-log-backfill] totalAccounts=${accounts.length} backfilled=${backfilled} skipped=${skipped}`,
  );
  return { totalAccounts: accounts.length, backfilled, skipped };
}

function mapToLogStatus(status: string): ZaloStatus | null {
  if (status === 'connected') return 'connected';
  if (status === 'disconnected') return 'disconnected';
  if (status === 'qr_pending') return 'qr_pending';
  if (status === 'auth_failed') return 'auth_failed';
  if (status === 'expired') return 'expired';
  return null;
}
