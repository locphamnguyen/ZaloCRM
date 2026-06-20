// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * interaction-cron.ts — Daily detection of interaction milestones.
 *
 * Currently: silent_30d — KH 30+ ngày không inbound. Log ActivityLog 1 lần khi
 * crossing threshold (lastInboundAt vừa qua mốc 30 ngày).
 *
 * Run daily 02:00 Vietnam time (19:00 UTC prev day). Idempotent qua dedup check.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';

const SILENT_THRESHOLD_DAYS = 30;

export function startInteractionCron(): void {
  // 19:00 UTC = 02:00 Vietnam time (UTC+7) — chạy sau midnight VN time
  cron.schedule('0 19 * * *', async () => {
    logger.info('[interaction-cron] Scanning for silent_30d contacts...');
    try {
      await runSilentDetection();
    } catch (err) {
      logger.error('[interaction-cron] silent_30d error:', err);
    }
  });
  logger.info('[interaction-cron] Daily silent_30d detection scheduled (19:00 UTC / 02:00 VN)');
}

/**
 * Find contacts crossing 30-day silence threshold today.
 * Conditions:
 *  - lastInboundAt < (now - 30 days)
 *  - lastInboundAt > (now - 31 days) — crossed within last 24h
 *  - No existing silent_30d log AFTER lastInboundAt → dedup khi cron re-run
 */
export async function runSilentDetection(): Promise<{ logged: number; scanned: number }> {
  const now = Date.now();
  const lowerBound = new Date(now - SILENT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const upperBound = new Date(now - (SILENT_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000);

  // Contacts có lastInboundAt vừa crossing 30d threshold (trong vòng 24h qua)
  const candidates = await prisma.contact.findMany({
    where: {
      lastInboundAt: { gte: upperBound, lt: lowerBound },
    },
    select: { id: true, orgId: true, lastInboundAt: true, fullName: true },
  });

  let logged = 0;
  for (const c of candidates) {
    const didLog = await withTenant(c.orgId, async () => {
      // Dedup: check đã có silent_30d log SAU lastInboundAt chưa
      const existing = await prisma.activityLog.findFirst({
        where: {
          orgId: c.orgId,
          entityType: 'contact',
          entityId: c.id,
          action: 'silent_30d',
          createdAt: { gte: c.lastInboundAt || new Date(0) },
        },
        select: { id: true },
      });
      if (existing) return false;

      logActivity({
        orgId: c.orgId,
        systemSource: 'interaction_cron',
        action: 'silent_30d',
        entityType: 'contact',
        entityId: c.id,
        details: { lastInboundAt: c.lastInboundAt, thresholdDays: SILENT_THRESHOLD_DAYS },
      });
      return true;
    });
    if (didLog) logged++;
  }

  logger.info(`[interaction-cron] silent_30d: scanned=${candidates.length}, logged=${logged}`);
  return { logged, scanned: candidates.length };
}
