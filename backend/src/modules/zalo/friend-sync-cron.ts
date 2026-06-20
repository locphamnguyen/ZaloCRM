// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * friend-sync-cron.ts — Periodic Friend full-sync cho mọi connected nick.
 *
 * Mỗi 15 phút:
 *  - Query connected ZaloAccount (status='connected')
 *  - Iterate sequential, mỗi account ~5s + 200ms stagger giữa accounts
 *  - Gọi syncFriendsForAccount (diff-then-emit) → catch alias/avatar/name change
 *    từ Zalo native app mà friend_event listener không bắt được
 *
 * Mutex chống overlap: nếu chu kỳ trước chưa xong khi tick mới → skip tick.
 * Sequential thay vì parallel để tránh burst Zalo rate-limit + ổn định CPU/RAM
 * (xem D3 trong plan eng-review).
 *
 * Errors per-account logged qua logActivity trong friend-sync-service. Cron loop
 * itself catch all để 1 account lỗi không break iteration.
 */
import cron from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { syncAccountFully } from './friend-sync-service.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';

// 15 phút. Đủ để bắt alias/name/avatar drift mà không spam Zalo rate-limit.
// Sequential 50 nick × 5s = 250s = ~4min → fit trong 15min window có dư 11min.
const CRON_SCHEDULE = '*/15 * * * *';

// 200ms stagger giữa accounts → smooth CPU + tránh burst SDK call.
const STAGGER_MS = 200;

// Mutex flag — true khi cron đang chạy. Tick mới đến trong khi true → skip.
let cronRunning = false;
let cronTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start periodic Friend sync cron. Idempotent — nếu đã start thì no-op.
 * Caller pass IO server để syncFriendsForAccount emit 'friend:updated' patches.
 */
export function startFriendSyncCron(io: Server | null): void {
  if (cronTask) {
    logger.info('[friend-sync-cron] Already started, skipping');
    return;
  }
  cronTask = cron.schedule(CRON_SCHEDULE, async () => {
    if (cronRunning) {
      logger.warn('[friend-sync-cron] Previous cycle still running, skipping this tick');
      return;
    }
    cronRunning = true;
    const startedAt = Date.now();
    try {
      await runCronCycle(io);
    } catch (err) {
      // Should not reach here (per-account errors caught inside) — defensive
      logger.error('[friend-sync-cron] Unexpected cycle error:', err);
    } finally {
      cronRunning = false;
      logger.info(`[friend-sync-cron] Cycle completed in ${Date.now() - startedAt}ms`);
    }
  });
  logger.info(`[friend-sync-cron] Started, schedule="${CRON_SCHEDULE}"`);
}

/** Stop cron task (dùng cho test cleanup / graceful shutdown). */
export function stopFriendSyncCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('[friend-sync-cron] Stopped');
  }
}

/** Single cycle: iterate connected accounts sequential with stagger. */
async function runCronCycle(io: Server | null): Promise<void> {
  // Cross-org sweep (mọi account connected mọi org) → runSystemQuery. Per-account
  // syncAccountFully tự bọc withTenant(acc.orgId) bên trong.
  const accounts = await runSystemQuery(() =>
    prisma.zaloAccount.findMany({
      where: { status: 'connected' },
      select: { id: true, orgId: true, displayName: true },
    }),
  );

  if (accounts.length === 0) {
    logger.info('[friend-sync-cron] No connected accounts, nothing to sync');
    return;
  }

  logger.info(`[friend-sync-cron] Starting cycle: ${accounts.length} connected account(s)`);

  let totalEmitted = 0;
  let totalAliases = 0;
  let totalLabels = 0;
  let totalErrors = 0;
  for (const acc of accounts) {
    try {
      const res = await syncAccountFully(acc.id, acc.orgId, {
        trigger: 'cron',
        io,
      });
      totalEmitted += res.friends?.emittedCount ?? 0;
      totalAliases += res.aliasesUpdated;
      totalLabels += res.labelsUpdated;
      totalErrors += res.errors.length + (res.friends?.errors ?? 0);
    } catch (err) {
      // syncAccountFully swallows per-branch errors → reaching here is unusual,
      // but cron loop must continue regardless.
      totalErrors++;
      logger.error(`[friend-sync-cron] Account ${acc.id} (${acc.displayName}) failed:`, err);
    }
    // Stagger giữa accounts để tránh burst Zalo rate-limit
    if (STAGGER_MS > 0) {
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  }

  logger.info(
    `[friend-sync-cron] Cycle stats: accounts=${accounts.length} friends_emitted=${totalEmitted} aliases=${totalAliases} labels=${totalLabels} errors=${totalErrors}`,
  );
}

/** Export for test injection — run 1 cycle directly without scheduling. */
export async function runFriendSyncCycleNow(io: Server | null): Promise<void> {
  return runCronCycle(io);
}
