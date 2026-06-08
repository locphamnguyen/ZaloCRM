// Phase G — update_status action handler (real impl).
//
// Reads blockSnapshot.statusId + optional onlyFromStatusIds guard, updates
// Contact.statusId. Simplest of the 3 phase-G actions (no Zalo SDK touch).

import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { ActionContext, ActionResult } from '../types.js';

export async function updateStatusHandler(ctx: ActionContext): Promise<ActionResult> {
  const snap = ctx.blockSnapshot as {
    statusId?: string;
    onlyFromStatusIds?: string[];
  };

  if (!snap.statusId || typeof snap.statusId !== 'string') {
    return {
      outcome: 'failure',
      errorCode: 'BAD_SNAPSHOT',
      errorMessage: 'blockSnapshot missing statusId',
      retryable: false,
    };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: ctx.contactId, orgId: ctx.orgId },
    select: { id: true, statusId: true },
  });
  if (!contact) {
    return {
      outcome: 'failure',
      errorCode: 'CONTACT_MISSING',
      errorMessage: `Contact ${ctx.contactId} not found`,
      retryable: false,
    };
  }

  // Optional guard: only apply if current status in allowlist
  if (Array.isArray(snap.onlyFromStatusIds) && snap.onlyFromStatusIds.length > 0) {
    if (!contact.statusId || !snap.onlyFromStatusIds.includes(contact.statusId)) {
      return {
        outcome: 'success',
        data: {
          skipped: true,
          reason: 'current status not in onlyFromStatusIds',
          currentStatusId: contact.statusId,
        },
      };
    }
  }

  // Validate target status exists in same org
  const targetStatus = await prisma.status.findFirst({
    where: { id: snap.statusId, orgId: ctx.orgId },
    select: { id: true, name: true },
  });
  if (!targetStatus) {
    return {
      outcome: 'failure',
      errorCode: 'STATUS_MISSING',
      errorMessage: `Target status ${snap.statusId} not found`,
      retryable: false,
    };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { statusId: snap.statusId },
  });

  logger.debug(`[update-status] contact ${contact.id}: ${contact.statusId} → ${snap.statusId}`);

  // CareSession 2026-06-07 (T7/T10f): đạt status trong closeConditions → đóng phiên (event-driven).
  try {
    const { closeCareSessionsOnConditionMatch } = await import(
      '../../care-session/care-session-service.js'
    );
    await closeCareSessionsOnConditionMatch({
      orgId: ctx.orgId,
      contactId: contact.id,
      matchKind: 'status',
      matchedId: snap.statusId,
    });
  } catch (err) {
    logger.warn(`[update-status] close care session on status failed: ${(err as Error).message}`);
  }

  return {
    outcome: 'success',
    data: {
      previousStatusId: contact.statusId,
      newStatusId: snap.statusId,
      newStatusName: targetStatus.name,
    },
  };
}
