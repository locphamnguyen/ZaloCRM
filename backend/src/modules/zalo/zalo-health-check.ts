// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-health-check.ts — Cron-based health monitor for Zalo account connections.
 * Runs every 5 minutes to detect disconnected accounts and auto-reconnect them.
 * Also runs a daily session refresh at 04:00 UTC to keep cookies fresh.
 */
import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { zaloPool } from './zalo-pool.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';

export function startZaloHealthCheck(): void {
  // Every 5 minutes: check all accounts with saved sessions
  cron.schedule('*/5 * * * *', async () => {
    try {
      // Cross-org admin sweep (account theo sessionData, không gắn 1 org) → runSystemQuery.
      // FIX 2 nick-ghost (2026-06-13): lọc SỚM thẻ ma (zaloUid=null) khỏi sweep — guard
      // chính nằm trong zaloPool.reconnect, đây là lớp 2 giảm tải (khỏi gọi reconnect rồi
      // mới bị từ chối). Chỉ reconnect nick THẬT (đã có zaloUid) chưa ẩn.
      // 2026-06-16: BỎ QUA nick NGẮT THỦ CÔNG (disconnectReason='manual') — ngắt là ngắt thật,
      // không tự reconnect. Nick mất kết nối THỤ ĐỘNG (passive/null) vẫn auto-reconnect như cũ.
      const accounts = await runSystemQuery(() =>
        prisma.zaloAccount.findMany({
          where: {
            sessionData: { not: Prisma.JsonNull }, archivedAt: null, zaloUid: { not: null },
            NOT: { disconnectReason: 'manual' },
          },
          select: { id: true, displayName: true, sessionData: true },
        }),
      );

      for (const acc of accounts) {
        const status = zaloPool.getStatus(acc.id);
        if (status !== 'connected' && status !== 'connecting' && status !== 'qr_pending') {
          const session = acc.sessionData as any;
          if (session?.imei) {
            logger.info(`[health-check] Reconnecting ${acc.displayName || acc.id}...`);
            zaloPool.reconnect(acc.id, session).catch((err) => {
              logger.warn(`[health-check] Reconnect failed for ${acc.id}:`, err);
            });
          }
        }
      }
    } catch (err) {
      logger.error('[health-check] Error during health check:', err);
    }
  });

  // Daily at 04:00 UTC (11:00 AM VN): refresh all sessions to keep cookies alive
  cron.schedule('0 4 * * *', async () => {
    logger.info('[health-check] Daily session refresh starting...');
    try {
      // Cross-org admin sweep (account theo sessionData, không gắn 1 org) → runSystemQuery.
      // FIX 2 nick-ghost (2026-06-13): chỉ refresh nick THẬT (zaloUid != null) chưa ẩn.
      // 2026-06-16: BỎ QUA nick ngắt thủ công (manual) — daily refresh KHÔNG làm sống lại nick
      // sale đã chủ động ngắt.
      const accounts = await runSystemQuery(() =>
        prisma.zaloAccount.findMany({
          where: {
            sessionData: { not: Prisma.JsonNull }, archivedAt: null, zaloUid: { not: null },
            NOT: { disconnectReason: 'manual' },
          },
          select: { id: true, sessionData: true },
        }),
      );

      for (const acc of accounts) {
        const session = acc.sessionData as any;
        if (session?.imei) {
          // Disconnect then reconnect to force cookie refresh
          zaloPool.disconnect(acc.id);
          await new Promise((r) => setTimeout(r, 5000));
          zaloPool.reconnect(acc.id, session).catch((err) => {
            logger.warn(`[health-check] Daily refresh failed for ${acc.id}:`, err);
          });
        }
        // Stagger reconnects by 10 seconds per account to avoid rate limits
        await new Promise((r) => setTimeout(r, 10000));
      }
    } catch (err) {
      logger.error('[health-check] Error during daily refresh:', err);
    }
  });

  // FIX 3 nick-ghost (Anh chốt 2026-06-13): mỗi giờ dọn thẻ ma qr_pending cũ bằng cách ẩn
  // (archivedAt). T4b (2026-06-20): đổi ngưỡng 15 phút → 24h — nick-ma phải HIỆN 24h ở UI
  // (badge "Đang chờ quét QR") trước khi ẩn, tránh biến mất giữa lúc sale quét QR dở.
  // Logic + điều kiện an toàn nằm trong zaloPool.cleanupStaleGhosts.
  cron.schedule('0 * * * *', async () => {
    try {
      const n = await zaloPool.cleanupStaleGhosts(24 * 60);
      if (n > 0) logger.info(`[health-check] dọn ${n} thẻ ma qr_pending cũ`);
    } catch (err) {
      logger.error('[health-check] Error during stale-ghost cleanup:', err);
    }
  });

  logger.info('[health-check] Zalo health check started (every 5 min + daily refresh 04:00 UTC + ghost cleanup hourly)');
}
