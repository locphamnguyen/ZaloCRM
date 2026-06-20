// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * engagement-cron.ts — Daily cron for Phase 8 Engagement Heatmap.
 *
 * Schedule: 02:30 VN time (19:30 UTC prev day).
 * Tasks:
 *   1. Recompute pattern/trend/score for every contact (over 28-day window)
 *   2. Cleanup engagement_daily rows older than 84 days (12 weeks rolling)
 *
 * Runtime: ~2-5 minutes cho org 5000 contacts. Batch processing 200 per chunk.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { recomputeContactEngagement } from './engagement-service.js';

const CLEANUP_RETENTION_DAYS = 84;

export function startEngagementCron(): void {
  // 19:30 UTC = 02:30 VN time
  cron.schedule('30 19 * * *', async () => {
    logger.info('[engagement-cron] Daily classification + cleanup starting');
    try {
      await runEngagementCron();
    } catch (err) {
      logger.error('[engagement-cron] error', err);
    }
  });
  logger.info('[engagement-cron] scheduled daily at 19:30 UTC (02:30 VN)');
}

export async function runEngagementCron(): Promise<{
  contactsReclassified: number;
  rowsCleaned: number;
  durationMs: number;
}> {
  const start = Date.now();
  const cutoff28 = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const cutoffCleanup = new Date(Date.now() - CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const { recomputeContactPriority } = await import('./priority-service.js');
  const { syncEngagementTagForOrg } = await import('./engagement-tag-service.js');

  // Phase 1a — Liệt kê org ở chế độ SYSTEM (cross-org), rồi xử lý từng org TRONG
  // withTenant để mọi org-scoped query (recompute / priority / cleanup / tag)
  // chạy đúng tenant context (tenant-guard + RLS).
  const orgs = await runSystemQuery(() =>
    prisma.organization.findMany({ select: { id: true } }),
  );

  let contactsReclassified = 0;
  let prioritiesUpdated = 0;
  let engagementTagsSynced = 0;
  let rowsCleaned = 0;

  for (const org of orgs) {
    await withTenant(org.id, async () => {
      // 1. Recompute pattern for contacts that have engagement data in last 28 days
      const contactsWithData = await prisma.contactEngagementDaily.findMany({
        where: { date: { gte: cutoff28 } },
        select: { contactId: true },
        distinct: ['contactId'],
      });
      for (const c of contactsWithData) {
        try {
          await recomputeContactEngagement(c.contactId);
          contactsReclassified++;
        } catch (err) {
          logger.warn('[engagement-cron] recompute failed', { contactId: c.contactId, err: (err as Error).message });
        }
      }

      // 2. Cleanup rows older than 84 days
      const cleanup = await prisma.contactEngagementDaily.deleteMany({
        where: { date: { lt: cutoffCleanup } },
      });
      rowsCleaned += cleanup.count;

      // 3. Phase 8.C — Recompute Priority Score cho mọi contact (sau khi engagement
      // đã classify lại để priority phản ánh trend mới nhất). Sẽ tự skip nếu không
      // đổi (saves index churn).
      const allContacts = await prisma.contact.findMany({ select: { id: true } });
      for (const c of allContacts) {
        const result = await recomputeContactPriority(c.id);
        if (result !== null) prioritiesUpdated++;
      }

      // 4. /office-hours 2026-06-06 — Sync Auto Engagement TAG (Hot/Cold) theo pattern mới.
      // Chạy TUẦN TỰ (1 contact / 1 tx) sau classification để tag engagement "sống" tự đổi,
      // giống Auto Detect. KHÔNG fire-and-forget trong loop recompute (tránh cạn pool).
      const tagSync = await syncEngagementTagForOrg(org.id);
      engagementTagsSynced += tagSync.synced;
    });
  }

  const result = {
    contactsReclassified,
    prioritiesUpdated,
    engagementTagsSynced,
    rowsCleaned,
    durationMs: Date.now() - start,
  };
  logger.info('[engagement-cron] done', result);
  return result;
}
