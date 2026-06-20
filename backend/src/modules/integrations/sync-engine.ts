// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * sync-engine.ts — Orchestrates sync execution for any integration type.
 * Delegates to provider-specific handlers and logs results.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { syncGoogleSheets } from './providers/google-sheets.js';
import { sendTelegramNotification } from './providers/telegram-bot.js';
import { importFacebookLeads } from '../../shared/ee-registry/integrations.js';
import { triggerZapierWebhook } from './providers/zapier-webhook.js';

interface Integration {
  id: string;
  orgId: string;
  type: string;
  config: unknown;
}

interface SyncResult {
  direction: 'import' | 'export';
  recordCount: number;
  status: 'success' | 'partial' | 'failed';
  errorMessage?: string;
}

export async function runSync(integration: Integration) {
  let result: SyncResult;

  try {
    const cfg = integration.config as Record<string, any>;

    switch (integration.type) {
      case 'google_sheets':
        result = await syncGoogleSheets(integration.orgId, cfg);
        break;
      case 'telegram':
        result = await sendTelegramNotification(integration.orgId, cfg);
        break;
      case 'facebook':
        result = await importFacebookLeads(integration.orgId, cfg);
        break;
      case 'zapier':
        result = await triggerZapierWebhook(integration.orgId, cfg);
        break;
      default:
        result = { direction: 'export', recordCount: 0, status: 'failed', errorMessage: `Unknown type: ${integration.type}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[sync-engine] ${integration.type} sync failed:`, msg);
    result = { direction: 'export', recordCount: 0, status: 'failed', errorMessage: msg };
  }

  // Persist sync log
  let log;
  try {
    log = await prisma.syncLog.create({
      data: {
        integrationId: integration.id,
        direction: result.direction,
        recordCount: result.recordCount,
        status: result.status,
        errorMessage: result.errorMessage ?? null,
      },
    });

    // Update lastSyncAt
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date() },
    });
  } catch (dbErr) {
    logger.error(`[sync-engine] Failed to persist sync log:`, dbErr);
    // Return result info even if log persistence failed
    return { ...result, integrationId: integration.id };
  }

  return log;
}
