import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getCurrentNotifications } from './notification-service.js';
import { sendPushToOrg } from './web-push-service.js';

const sentBuckets = new Set<string>();

function bucketFor(nowMs: number) {
  return Math.floor(nowMs / (30 * 60 * 1000));
}

export async function runSystemNotificationPushOnce(nowMs = Date.now()) {
  const bucket = bucketFor(nowMs);
  const orgs = await prisma.organization.findMany({
    where: { webPushSubscriptions: { some: {} } },
    select: { id: true },
  });

  for (const org of orgs) {
    const notifications = await getCurrentNotifications(org.id);
    for (const notification of notifications) {
      const dedupeKey = `${bucket}:${org.id}:${notification.id}`;
      if (sentBuckets.has(dedupeKey)) continue;
      sentBuckets.add(dedupeKey);
      await sendPushToOrg(org.id, {
        title: notification.title,
        body: notification.detail,
        url: notification.url,
        tag: `system-${notification.id}`,
        type: notification.type,
        priority: notification.priority,
        createdAt: notification.createdAt,
      });
    }
  }

  if (sentBuckets.size > 5000) sentBuckets.clear();
}

export function startSystemNotificationPushJob() {
  cron.schedule('*/5 * * * *', () => {
    runSystemNotificationPushOnce().catch((error) => {
      logger.warn({ err: error }, 'system notification push job failed');
    });
  });
}
