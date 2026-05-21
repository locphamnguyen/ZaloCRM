/**
 * notification-dispatcher.ts — Minimal lead assignment notification.
 *
 * MVP: writes ActivityLog record (type=lead_assigned).
 * Phase 2 will add email/push/socket emit.
 *
 * No existing push/email notification service — using ActivityLog as source
 * of truth for in-app notification queries (notification-routes already reads it
 * indirectly via contact timeline).
 */

import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * Record lead assignment in ActivityLog.
 * Non-blocking: errors are logged but not re-thrown (notification failure
 * must not fail the ingestion pipeline).
 */
export async function notifySaleAssigned(
  orgId: string,
  userId: string,
  contactId: string,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        orgId,
        actorType: 'system',
        systemSource: 'fb_lead_ingestion',
        category: 'automation',
        action: 'lead_assigned',
        entityType: 'contact',
        entityId: contactId,
        details: { assignedUserId: userId, source: 'fb_lead' },
      },
    });
  } catch (err) {
    // Non-fatal — log and continue
    logger.error('[notification-dispatcher] failed to write ActivityLog: %s', (err as Error).message);
  }
}
