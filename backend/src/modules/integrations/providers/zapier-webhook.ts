// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zapier-webhook.ts — Trigger Zapier webhooks with CRM data.
 * Config shape: { webhookUrl: string, events?: string[] }
 * Sends latest contacts as payload to Zapier catch hook.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { assertSafeOutboundUrl, SsrfBlockedError } from '../../../shared/utils/ssrf-guard.js';

interface ZapierConfig {
  webhookUrl?: string;
}

export async function triggerZapierWebhook(
  orgId: string,
  config: ZapierConfig,
): Promise<{ direction: 'export'; recordCount: number; status: 'success' | 'failed'; errorMessage?: string }> {
  const { webhookUrl } = config;

  if (!webhookUrl) {
    return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: 'Missing webhookUrl' };
  }

  // SSRF guard via shared util — covers loopback, RFC1918, link-local, metadata,
  // IPv6 ULA + scheme enforcement (HTTPS only). See ssrf-guard.ts for full list.
  try {
    assertSafeOutboundUrl(webhookUrl);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: err.message };
    }
    return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: 'Invalid webhookUrl' };
  }

  try {
    // Send recent contacts created in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const contacts = await prisma.contact.findMany({
      where: { orgId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const payload = {
      event: 'contacts.sync',
      orgId,
      timestamp: new Date().toISOString(),
      count: contacts.length,
      contacts: contacts.map((c: any) => ({
        id: c.id,
        fullName: c.fullName,
        phone: c.phone,
        email: c.email,
        source: c.source,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error('[zapier-webhook] Error:', body);
      return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: `Zapier ${response.status}: ${body.slice(0, 200)}` };
    }

    logger.info(`[zapier-webhook] Sent ${contacts.length} contacts to Zapier`);
    return { direction: 'export', recordCount: contacts.length, status: 'success' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: msg };
  }
}
