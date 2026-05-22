import webPush from 'web-push';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  type: string;
  priority: string;
  createdAt: string;
}

export interface WebPushSendResult {
  attempted: number;
  sent: number;
  expired: number;
  failed: number;
  enabled: boolean;
}

let configuredFor = '';

export function getWebPushConfig() {
  const publicKey = process.env.VAPID_PUBLIC || '';
  const privateKey = process.env.VAPID_PRIVATE || '';
  return { enabled: Boolean(publicKey && privateKey), publicKey };
}

function ensureVapidConfigured(): boolean {
  const { enabled, publicKey } = getWebPushConfig();
  const privateKey = process.env.VAPID_PRIVATE || '';
  if (!enabled) return false;

  const subject = process.env.VAPID_SUBJECT || process.env.APP_URL || 'mailto:admin@zalocrm.local';
  const configKey = `${subject}:${publicKey}:${privateKey}`;
  if (configuredFor !== configKey) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    configuredFor = configKey;
  }
  return true;
}

export async function sendPushToSubscriptions(
  subscriptions: StoredPushSubscription[],
  payload: WebPushPayload,
): Promise<WebPushSendResult> {
  if (!ensureVapidConfigured()) {
    return { attempted: subscriptions.length, sent: 0, expired: 0, failed: 0, enabled: false };
  }

  const expiredIds: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        expiredIds.push(subscription.id);
        return;
      }
      failed += 1;
      logger.warn({ err: error, endpoint: subscription.endpoint }, 'web push delivery failed');
    }
  }));

  if (expiredIds.length > 0) {
    await prisma.webPushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
  }

  return { attempted: subscriptions.length, sent, expired: expiredIds.length, failed, enabled: true };
}

export async function sendPushToUser(userId: string, orgId: string, payload: WebPushPayload) {
  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { userId, orgId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return sendPushToSubscriptions(subscriptions, payload);
}

export async function sendPushToUsers(userIds: string[], orgId: string, payload: WebPushPayload) {
  if (userIds.length === 0) {
    return { attempted: 0, sent: 0, expired: 0, failed: 0, enabled: getWebPushConfig().enabled };
  }

  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { orgId, userId: { in: userIds } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return sendPushToSubscriptions(subscriptions, payload);
}

export async function sendPushToOrg(orgId: string, payload: WebPushPayload) {
  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { orgId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return sendPushToSubscriptions(subscriptions, payload);
}
