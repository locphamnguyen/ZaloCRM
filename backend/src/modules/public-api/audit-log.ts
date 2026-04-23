/**
 * audit-log.ts — Fire-and-forget audit log writer for public API write operations.
 * Writes to ActivityLog with userId=null to distinguish API-key-driven writes.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import type { Scope } from './api-key-types.js';

/**
 * Log a public API write operation to ActivityLog.
 * Fire-and-forget: never throws, never awaited by caller.
 */
export function logPublicApiWrite(
  orgId: string,
  action: string,
  entityType: string,
  entityId: string,
  apiKeyId: string,
  scopes: Scope[],
): void {
  prisma.activityLog
    .create({
      data: {
        orgId,
        userId: null,
        action: `public_api.${action}`,
        entityType,
        entityId,
        details: { apiKeyId, scopes },
      },
    })
    .catch(() => {
      // Non-critical audit — ignore write failures silently
    });
}
