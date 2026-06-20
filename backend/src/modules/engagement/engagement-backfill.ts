// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * engagement-backfill.ts — One-time backfill ContactEngagementDaily from existing data.
 *
 * Scans Message + MessageReaction within the last N days (default 28). Groups by
 * (contactId, UTC date) and aggregates per-day counters, then recomputes intensity +
 * pattern classification.
 *
 * Runtime: ~5-10 min cho org có 5000 contacts × 28 days.
 *
 * Idempotent: re-running rewrites existing rows for the window.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { computeDailyIntensity, recomputeContactEngagement, parseCallMeta } from './engagement-service.js';

interface BackfillOptions {
  orgId: string;
  days: number;
}

interface BackfillResult {
  daysBackfilled: number;
  contactsTouched: number;
  rowsWritten: number;
  durationMs: number;
}

function toUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Phải đồng bộ với engagement-service.ts (anh chốt mở rộng 2026-05-21):
// "File/ảnh/video" bao gồm thoại, vị trí, đính kèm danh thiếp, sticker, ...
const MEDIA_TYPES = new Set([
  'image', 'video', 'file', 'voice', 'audio', 'sticker',
  'location', 'contact_card', 'bank_transfer', 'gif',
]);
const VOICE_TYPES = new Set(['voice', 'audio']);

export async function runBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const start = Date.now();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (opts.days - 1));

  logger.info('[engagement-backfill] start', { orgId: opts.orgId, days: opts.days, since: since.toISOString() });

  // Pull messages joined with conversation→contact
  const messages = await prisma.message.findMany({
    where: {
      sentAt: { gte: since },
      conversation: { orgId: opts.orgId, contactId: { not: null }, threadType: 'user' },
    },
    select: {
      id: true,
      sentAt: true,
      senderType: true,
      contentType: true,
      content: true,
      conversationId: true,
      quote: true,
      conversation: { select: { contactId: true } },
      reactions: {
        select: { reactorSource: true },
      },
    },
  });

  // Bucket: contactId → date(YYYY-MM-DD) → row
  type Row = {
    inboundMsgCount: number;
    outboundMsgCount: number;
    reactionCount: number;
    mediaShareCount: number;
    voiceMsgCount: number;
    callCount: number;
    missedCallCount: number;
    quoteReplyCount: number;
    customerInitiated: boolean;
    /** earliest sentAt today (used to determine customerInitiated) */
    firstSentAt: number;
    /** isSelf at firstSentAt */
    firstIsSelf: boolean;
  };
  const buckets = new Map<string, Map<string, Row>>(); // contactId → date → row

  for (const m of messages) {
    const contactId = m.conversation?.contactId;
    if (!contactId) continue;
    const day = toUtcDay(m.sentAt);
    const dateKey = day.toISOString().slice(0, 10);

    let perContact = buckets.get(contactId);
    if (!perContact) {
      perContact = new Map();
      buckets.set(contactId, perContact);
    }
    let row = perContact.get(dateKey);
    if (!row) {
      row = {
        inboundMsgCount: 0,
        outboundMsgCount: 0,
        reactionCount: 0,
        mediaShareCount: 0,
        voiceMsgCount: 0,
        callCount: 0,
        missedCallCount: 0,
        quoteReplyCount: 0,
        customerInitiated: false,
        firstSentAt: Number.POSITIVE_INFINITY,
        firstIsSelf: false,
      };
      perContact.set(dateKey, row);
    }

    const isSelf = m.senderType === 'self';
    const ct = m.contentType;
    const isMedia = MEDIA_TYPES.has(ct);
    const isVoice = VOICE_TYPES.has(ct);
    const isCall = ct === 'call';
    const q = m.quote as unknown;
    const hasQuote = q !== null && q !== undefined
      && (typeof q !== 'object' || Object.keys(q as object).length > 0);

    if (isSelf) row.outboundMsgCount++;
    else row.inboundMsgCount++;

    if (!isSelf && isMedia) row.mediaShareCount++;
    if (!isSelf && isVoice) row.voiceMsgCount++;
    if (!isSelf && hasQuote) row.quoteReplyCount++;
    if (isCall) {
      // Parse content (stored as JSON text) → tách missed vs connected
      let parsedContent: unknown = null;
      try {
        parsedContent = typeof m.content === 'string' && m.content.startsWith('{')
          ? JSON.parse(m.content)
          : m.content;
      } catch { /* ignore */ }
      const meta = parseCallMeta(parsedContent, isSelf);
      if (meta) {
        if (meta.isMissed) row.missedCallCount++;
        else row.callCount++;
      }
    }

    // Reactions: count only zalo-sourced (KH thả ❤️ trên tin sale)
    if (isSelf) {
      for (const r of m.reactions || []) {
        if (r.reactorSource === 'zalo') row.reactionCount++;
      }
    }

    // Track earliest message of the day for customerInitiated logic
    const ts = m.sentAt.getTime();
    if (ts < row.firstSentAt) {
      row.firstSentAt = ts;
      row.firstIsSelf = isSelf;
    }
  }

  // Derive customerInitiated: first msg of day là inbound (KH nhắn trước)
  for (const perContact of buckets.values()) {
    for (const row of perContact.values()) {
      row.customerInitiated = !row.firstIsSelf;
    }
  }

  // Write rows (upsert pattern via SQL bulk for speed)
  let rowsWritten = 0;
  for (const [contactId, perContact] of buckets) {
    for (const [dateKey, row] of perContact) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const intensity = computeDailyIntensity({
        inboundMsgCount: row.inboundMsgCount,
        outboundMsgCount: row.outboundMsgCount,
        reactionCount: row.reactionCount,
        mediaShareCount: row.mediaShareCount,
        voiceMsgCount: row.voiceMsgCount,
        callCount: row.callCount,
        missedCallCount: row.missedCallCount,
        quoteReplyCount: row.quoteReplyCount,
        customerInitiated: row.customerInitiated,
      });

      await prisma.contactEngagementDaily.upsert({
        where: { orgId_contactId_date: { orgId: opts.orgId, contactId, date } },
        update: {
          inboundMsgCount: row.inboundMsgCount,
          outboundMsgCount: row.outboundMsgCount,
          reactionCount: row.reactionCount,
          mediaShareCount: row.mediaShareCount,
          voiceMsgCount: row.voiceMsgCount,
          callCount: row.callCount,
          missedCallCount: row.missedCallCount,
          quoteReplyCount: row.quoteReplyCount,
          customerInitiated: row.customerInitiated,
          dailyIntensity: intensity,
        },
        create: {
          orgId: opts.orgId,
          contactId,
          date,
          inboundMsgCount: row.inboundMsgCount,
          outboundMsgCount: row.outboundMsgCount,
          reactionCount: row.reactionCount,
          mediaShareCount: row.mediaShareCount,
          voiceMsgCount: row.voiceMsgCount,
          callCount: row.callCount,
          missedCallCount: row.missedCallCount,
          quoteReplyCount: row.quoteReplyCount,
          customerInitiated: row.customerInitiated,
          dailyIntensity: intensity,
        },
      }).catch((err: any) => {
        logger.warn('[engagement-backfill] upsert failed', { contactId, dateKey, err: err.message });
      });
      rowsWritten++;
    }
  }

  // Recompute pattern + trend cho mọi contact touched
  let contactsTouched = 0;
  for (const contactId of buckets.keys()) {
    try {
      await recomputeContactEngagement(contactId);
      contactsTouched++;
    } catch (err) {
      logger.warn('[engagement-backfill] recompute failed', { contactId, err: (err as Error).message });
    }
  }

  const result: BackfillResult = {
    daysBackfilled: opts.days,
    contactsTouched,
    rowsWritten,
    durationMs: Date.now() - start,
  };
  logger.info('[engagement-backfill] done', result);
  return result;
}
