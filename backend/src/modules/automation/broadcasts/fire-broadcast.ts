// Phase F — Shared "fire a broadcast" logic.
//
// Extracted so both broadcast-routes.ts (manual /start) and
// broadcast-scheduler.ts (cron-triggered scheduled broadcasts) share the same
// recipient resolve + task enqueue path.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { sanitizeContactCriteria, sanitizeManualContactIds } from '../engine/segment-sanitizer.js';

interface BroadcastRow {
  id: string;
  orgId: string;
  blockId: string;
  segmentSpec: unknown;
  pacing: unknown;
}

export async function resolveAndEnqueue(bc: BroadcastRow): Promise<{ recipients: number; claimed: boolean }> {
  // FIX A3 — Atomic claim. Prevents scheduler + manual /start + concurrent
  // instances from double-firing. updateMany only matches if state ∈ {draft,
  // scheduled, paused} AND no other process has already transitioned to running.
  const claim = await prisma.automationBroadcast.updateMany({
    where: {
      id: bc.id,
      orgId: bc.orgId,
      state: { in: ['draft', 'scheduled', 'paused'] },
    },
    data: {
      state: 'running',
      startedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    // Race lost or already running/completed/cancelled
    logger.warn(`[broadcast] ${bc.id} claim failed — already running or terminal state`);
    return { recipients: 0, claimed: false };
  }

  // 1. Resolve segment → contactIds
  const allContactIds = await resolveSegmentContactIds(bc.orgId, bc.segmentSpec);

  // 2. Filter to friendable (send_message requires existing Friend)
  const friendableContacts = allContactIds.length === 0
    ? []
    : await prisma.contact.findMany({
        where: {
          id: { in: allContactIds },
          orgId: bc.orgId,
          acceptedNicksCount: { gt: 0 },
        },
        select: { id: true },
      });
  const recipientIds = friendableContacts.map((c) => c.id);

  // 3. Update broadcast totals (state already 'running' from atomic claim above)
  await prisma.automationBroadcast.update({
    where: { id: bc.id },
    data: {
      totalRecipients: recipientIds.length,
      sentCount: 0,
      deliveredCount: 0,
      failedCount: 0,
    },
  });

  if (recipientIds.length === 0) {
    await prisma.automationBroadcast.update({
      where: { id: bc.id },
      data: { state: 'completed', completedAt: new Date() },
    });
    logger.info(`[broadcast] ${bc.id} no friendable recipients → completed immediately`);
    return { recipients: 0, claimed: true };
  }

  // 4. Snapshot block content for task immutability
  const block = await prisma.block.findUnique({
    where: { id: bc.blockId },
    select: { content: true },
  });
  if (!block) throw new Error('block not found at enqueue time');

  // 5. Create Campaign + bulk Tasks
  const campaign = await prisma.automationCampaign.create({
    data: {
      id: randomUUID(),
      orgId: bc.orgId,
      broadcastId: bc.id,
      executionKind: 'broadcast',
      blockId: bc.blockId,
      segmentSnapshot: { contactIds: recipientIds } as object,
      rulesSnapshot: (bc.pacing ?? {}) as object,
      state: 'active',
    },
  });

  const delay = (bc.pacing as { randomDelayBetweenSends?: { min: number; max: number } })?.randomDelayBetweenSends
    ?? { min: 15, max: 45 };
  const now = Date.now();

  const tasksData = recipientIds.map((contactId) => {
    const jitterMs = (delay.min + Math.random() * Math.max(0, delay.max - delay.min)) * 60 * 1000;
    return {
      id: randomUUID(),
      orgId: bc.orgId,
      campaignId: campaign.id,
      contactId,
      currentBlockId: bc.blockId,
      blockSnapshot: block.content as object,
      scheduledAt: new Date(now + jitterMs),
      state: 'queued',
    };
  });

  const CHUNK = 500;
  for (let i = 0; i < tasksData.length; i += CHUNK) {
    await prisma.automationTask.createMany({
      data: tasksData.slice(i, i + CHUNK),
    });
  }

  logger.info(`[broadcast] fired ${bc.id} — ${recipientIds.length} recipients enqueued`);
  return { recipients: recipientIds.length, claimed: true };
}

async function resolveSegmentContactIds(orgId: string, spec: unknown): Promise<string[]> {
  if (!spec || typeof spec !== 'object') return [];
  const s = spec as Record<string, unknown>;

  if (s.kind === 'manual' && Array.isArray(s.contactIds)) {
    const safeIds = sanitizeManualContactIds(s.contactIds);
    if (safeIds.length === 0) return [];
    const verified = await prisma.contact.findMany({
      where: { id: { in: safeIds }, orgId },
      select: { id: true },
    });
    return verified.map((c) => c.id);
  }
  if (s.kind === 'filter' && typeof s.criteria === 'object' && s.criteria !== null) {
    const result = sanitizeContactCriteria(orgId, s.criteria);
    if (!result.ok || !result.where) return [];
    if (result.rejected?.length) {
      logger.warn(`[fire-broadcast] criteria rejected fields: ${result.rejected.join(', ')}`);
    }
    const rows = await prisma.contact.findMany({ where: result.where, select: { id: true }, take: 10000 });
    return rows.map((r) => r.id);
  }
  if (s.kind === 'customer-list' && typeof s.listId === 'string') {
    // CustomerListEntry stores phoneE164 ("+84xxx") and phoneLocal ("0xxx").
    // Contact.phoneNormalized uses canonical "84xxx" — strip "+" from E164 to match.
    const entries = await prisma.customerListEntry.findMany({
      where: {
        customerListId: s.listId,
        status: { in: ['enriched', 'validated'] },
        phoneValid: true,
      },
      select: { phoneE164: true, contactId: true },
      take: 50000,
    });

    // Prefer direct contactId link if set, else match via phone
    const linkedContactIds = entries
      .map((e) => e.contactId)
      .filter((id): id is string => Boolean(id));
    const phones84 = entries
      .filter((e) => !e.contactId && e.phoneE164)
      .map((e) => e.phoneE164!.replace(/^\+/, '')); // "+84xxx" → "84xxx"

    if (linkedContactIds.length === 0 && phones84.length === 0) return [];

    const allIds = new Set<string>(linkedContactIds);
    if (phones84.length > 0) {
      const matched = await prisma.contact.findMany({
        where: { orgId, phoneNormalized: { in: phones84 } },
        select: { id: true },
        take: 50000,
      });
      for (const c of matched) allIds.add(c.id);
    }
    return Array.from(allIds);
  }
  return [];
}
