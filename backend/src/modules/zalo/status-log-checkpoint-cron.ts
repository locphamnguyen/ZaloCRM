// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * status-log-checkpoint-cron.ts — Phase ZaloAccounts redesign 2026-05-22
 *
 * Cron 5 phút reconcile orphan open records sau crash hoặc network glitch.
 *
 * Algorithm:
 *   1. Snapshot zaloPool.getAllStatuses() → in-memory truth ngay lúc cron tick.
 *   2. Với mỗi nick có open record trong DB:
 *      - Nếu open.status === pool.status → no-op (đồng bộ).
 *      - Nếu khác → writeTransition với reason='checkpoint' (đồng bộ DB về pool).
 *   3. Với mỗi nick TRONG pool mà KHÔNG có open record → writeTransition (đời sống mới
 *      sau backfill miss hoặc DB inconsistency).
 *
 * Idempotent: chạy nhiều lần liên tiếp không tạo log thừa (writeTransition skip nếu
 * status không đổi).
 *
 * Mutex chống overlap như friend-sync-cron pattern.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { writeTransition, type ZaloStatus } from './status-log-service.js';
import { zaloPool } from './zalo-pool.js';
import { withTenant, runSystemQuery } from '../../shared/tenant/tenant-context.js';

// 5 phút — đủ tight để uptime drift trong window 5p, đủ rộng để không spam DB.
const CRON_SCHEDULE = '*/5 * * * *';

let cronRunning = false;
let cronTask: ReturnType<typeof cron.schedule> | null = null;

export function startStatusLogCheckpointCron(): void {
  if (cronTask) {
    logger.info('[status-log-checkpoint] Already started, skipping');
    return;
  }
  cronTask = cron.schedule(CRON_SCHEDULE, async () => {
    if (cronRunning) {
      logger.warn('[status-log-checkpoint] Previous cycle still running, skipping this tick');
      return;
    }
    cronRunning = true;
    const startedAt = Date.now();
    try {
      await runCheckpoint();
    } catch (err) {
      logger.error('[status-log-checkpoint] Unexpected cycle error:', err);
    } finally {
      cronRunning = false;
      logger.info(`[status-log-checkpoint] Cycle completed in ${Date.now() - startedAt}ms`);
    }
  });
  logger.info(`[status-log-checkpoint] Started, schedule="${CRON_SCHEDULE}"`);
}

export function stopStatusLogCheckpointCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('[status-log-checkpoint] Stopped');
  }
}

/** Single checkpoint cycle. Exported cho test + manual trigger. */
export async function runCheckpoint(): Promise<{
  scanned: number;
  reconciled: number;
  created: number;
}> {
  const poolStatuses = zaloPool.getAllStatuses();
  const poolIds = new Set(Object.keys(poolStatuses));

  // Find all accounts to reconcile: pool nicks + DB nicks có open record.
  // Cross-org scan (toàn bộ account mọi org) → runSystemQuery; per-account
  // reconcile chạy trong tenant context của org đó.
  const dbAccounts = await runSystemQuery(() =>
    prisma.zaloAccount.findMany({
      select: { id: true, orgId: true, status: true },
    }),
  );

  let reconciled = 0;
  let created = 0;
  let scanned = 0;

  for (const acct of dbAccounts) {
    scanned++;
    // Live status: pool > DB column (pool là truth realtime)
    const liveStatusRaw = poolStatuses[acct.id] ?? acct.status;
    const liveStatus = mapToLogStatus(liveStatusRaw);
    if (!liveStatus) continue; // 'connecting' hoặc unknown → skip

    const outcome = await withTenant(acct.orgId, async () => {
      const open = await prisma.zaloAccountStatusLog.findFirst({
        where: { accountId: acct.id, endedAt: null },
        select: { status: true },
      });

      if (!open) {
        // Không có open record → tạo mới (crash recovery hoặc backfill miss)
        await writeTransition({
          accountId: acct.id,
          orgId: acct.orgId,
          status: liveStatus,
          reason: 'crash_recovery',
        });
        return 'created' as const;
      }

      if (open.status !== liveStatus) {
        // Drift: pool nói X, DB log nói Y → đồng bộ về pool
        await writeTransition({
          accountId: acct.id,
          orgId: acct.orgId,
          status: liveStatus,
          reason: 'checkpoint',
        });
        return 'reconciled' as const;
      }
      // else: open.status === liveStatus → no-op (đồng bộ)
      return 'noop' as const;
    });

    if (outcome === 'created') created++;
    else if (outcome === 'reconciled') reconciled++;
  }

  if (reconciled > 0 || created > 0) {
    logger.info(
      `[status-log-checkpoint] scanned=${scanned} reconciled=${reconciled} created=${created} pool=${poolIds.size}`,
    );
  }

  return { scanned, reconciled, created };
}

function mapToLogStatus(status: string): ZaloStatus | null {
  if (status === 'connected') return 'connected';
  if (status === 'disconnected') return 'disconnected';
  if (status === 'qr_pending') return 'qr_pending';
  if (status === 'auth_failed') return 'auth_failed';
  if (status === 'expired') return 'expired';
  return null;
}
