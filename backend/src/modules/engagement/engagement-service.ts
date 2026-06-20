// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * engagement-service.ts — Phase 8 Engagement Heatmap Timeline
 *
 * Incremental aggregate per (Contact × date) cho heatmap UI 4-week timeline +
 * pattern classification cron.
 *
 * Architecture:
 *   - Real-time: incrementDailyAggregate() fired from message-handler +
 *     reaction handler. Upsert today's row, recompute dailyIntensity.
 *   - Daily cron 02:30 VN: classifyEngagementPattern() per Contact dựa trên
 *     28-day window, cleanup rows >84 days (12 weeks).
 *
 * Daily intensity formula (0-100, capped):
 *   30 × reactionCount + 30 × voiceMsgCount + 20 × customerInitiated_bool
 *   + 15 × mediaShareCount + 5 × inboundMsgCount + 5 × outboundMsgCount
 *
 * Pattern classification:
 *   - hot:      Trend ≥+20% week-over-week, week 4 avgIntensity ≥40
 *   - champion: Avg intensity ≥75 across 28 days (consistent high)
 *   - stable:   Avg 25-74, low variance (std dev <15)
 *   - cooling:  Trend ≤-30% week-over-week
 *   - cold:     Avg intensity <15 across 28 days
 *   - noise:    <5 total interactions in 28 days (insufficient data)
 */
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export type EngagementPattern = 'hot' | 'champion' | 'stable' | 'cooling' | 'cold' | 'noise';

export interface IncrementInput {
  contactId: string;
  orgId: string;
  /** When the event happened. Defaults to now. Date-truncated to UTC day. */
  at?: Date;
  /** Counters to add — all default 0 / false */
  inboundMsg?: number;
  outboundMsg?: number;
  reaction?: number;
  mediaShare?: number;
  voiceMsg?: number;
  call?: number;          // KH gọi connected (duration > 0)
  missedCall?: number;    // KH gọi nhỡ (duration = 0)
  quoteReply?: number;
  /** True nếu KH chủ động nhắn trong ngày (sale chưa ping trước) */
  customerInitiated?: boolean;
}

/**
 * Parse Zalo call message content → tách connected vs missed call.
 *
 * Shape: `{"action":"recommened.calltime","params":"{\"duration\":39,\"isCaller\":0,...}"}`
 * isCaller=0 → KH gọi sale (engagement signal). isCaller=1 → sale gọi KH (skip).
 * duration=0 OR action=*misscall* → missed.
 *
 * Returns null nếu không phải call hoặc sale-side call.
 */
export function parseCallMeta(content: unknown, isSelf: boolean): { isMissed: boolean } | null {
  if (isSelf) return null; // sale-side call không phải engagement signal từ KH
  if (typeof content !== 'object' || content === null) return null;
  const c = content as Record<string, unknown>;
  const action = typeof c.action === 'string' ? c.action : '';
  const isCallAction = action.includes('calltime') || action.includes('misscall');
  if (!isCallAction) return null;

  // Missed call: action chứa 'misscall' hoặc duration=0
  if (action.includes('misscall')) return { isMissed: true };

  let duration = 0;
  if (typeof c.params === 'string') {
    try {
      const p = JSON.parse(c.params);
      duration = Number(p?.duration ?? 0);
    } catch { /* parse fail → treat as 0 */ }
  } else if (typeof c.params === 'object' && c.params !== null) {
    duration = Number((c.params as { duration?: number }).duration ?? 0);
  }
  return { isMissed: duration <= 0 };
}

// 4. "File/ảnh/video" group — broad set, hiểu là mọi content non-text từ KH:
// ảnh, video, file, voice/audio, location, contact_card, sticker, bank_transfer.
const MEDIA_TYPES = new Set([
  'image', 'video', 'file', 'voice', 'audio', 'sticker',
  'location', 'contact_card', 'bank_transfer', 'gif',
]);
const VOICE_TYPES = new Set(['voice', 'audio']);

/**
 * Map message → engagement signals (KH-side only).
 *
 * Signals tracked:
 *   - inbound/outbound: every message
 *   - mediaShare: KH gửi non-text (broad set, see MEDIA_TYPES)
 *   - voiceMsg: KH gửi voice/audio recording (subset of media)
 *   - call: KH gọi connected (duration > 0)
 *   - missedCall: KH gọi nhỡ (duration = 0) — intent yếu hơn
 *   - quoteReply: KH dùng quote-reply để phản hồi 1 tin của sale (strong intent)
 *
 * @param callMeta — set khi contentType='call', tách missed vs connected.
 */
export function messageEngagementInputs(
  contentType: string,
  isSelf: boolean,
  hasQuote = false,
  callMeta: { isMissed: boolean } | null = null,
): { mediaShare: number; voiceMsg: number; call: number; missedCall: number; quoteReply: number; inbound: number; outbound: number } {
  const isMedia = MEDIA_TYPES.has(contentType);
  const isVoice = VOICE_TYPES.has(contentType);
  const isCall = contentType === 'call' && !isSelf;
  return {
    inbound: isSelf ? 0 : 1,
    outbound: isSelf ? 1 : 0,
    // Các signal sau chỉ tính khi KH gửi (sale-side actions không phải engagement signal)
    mediaShare: !isSelf && isMedia ? 1 : 0,
    voiceMsg: !isSelf && isVoice ? 1 : 0,
    call: isCall && callMeta && !callMeta.isMissed ? 1 : 0,
    missedCall: isCall && callMeta && callMeta.isMissed ? 1 : 0,
    quoteReply: !isSelf && hasQuote ? 1 : 0,
  };
}

/**
 * Compute daily intensity score 0-100 from raw counters.
 *
 * Weights — anh chốt 2026-05-21:
 *   call           35  — cuộc gọi connected (KH gọi & nói chuyện thật)
 *   reaction       30  — KH thả tim
 *   voiceMsg       30  — tin thoại ghi âm
 *   quoteReply     25  — KH quote-reply có chủ ý
 *   customerInitiated 20 (once/day) — KH chủ động nhắn trước
 *   mediaShare     15  — ảnh/video/file/sticker/location/...
 *   missedCall      5  — KH gọi nhỡ (intent yếu)
 *   inbound         5  — tin KH text
 *   outbound        5  — sale chăm KH
 */
export function computeDailyIntensity(row: {
  inboundMsgCount: number;
  outboundMsgCount: number;
  reactionCount: number;
  mediaShareCount: number;
  voiceMsgCount: number;
  callCount: number;
  missedCallCount: number;
  quoteReplyCount: number;
  customerInitiated: boolean;
}): number {
  const score =
    row.callCount * 35 +
    row.reactionCount * 30 +
    row.voiceMsgCount * 30 +
    row.quoteReplyCount * 25 +
    (row.customerInitiated ? 20 : 0) +
    row.mediaShareCount * 15 +
    row.missedCallCount * 5 +
    row.inboundMsgCount * 5 +
    row.outboundMsgCount * 5;
  return Math.min(100, Math.max(0, score));
}

/**
 * Truncate Date to UTC day (date column requires DATE-only).
 */
function toUtcDay(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return day;
}

/**
 * Fire-and-forget incremental aggregate write.
 *
 * Called from message-handler + reaction handler. Failures are logged but
 * never block message persistence (engagement is best-effort).
 *
 * Atomic upsert + recompute dailyIntensity. Postgres ON CONFLICT clause
 * ensures concurrent writes don't lose updates.
 */
export async function incrementDailyAggregate(input: IncrementInput): Promise<void> {
  if (!input.contactId || !input.orgId) return;

  const date = toUtcDay(input.at ?? new Date());
  const inc = {
    inboundMsg: input.inboundMsg ?? 0,
    outboundMsg: input.outboundMsg ?? 0,
    reaction: input.reaction ?? 0,
    mediaShare: input.mediaShare ?? 0,
    voiceMsg: input.voiceMsg ?? 0,
    call: input.call ?? 0,
    missedCall: input.missedCall ?? 0,
    quoteReply: input.quoteReply ?? 0,
  };
  const setCustomerInitiated = input.customerInitiated === true;

  if (
    inc.inboundMsg === 0 &&
    inc.outboundMsg === 0 &&
    inc.reaction === 0 &&
    inc.mediaShare === 0 &&
    inc.voiceMsg === 0 &&
    inc.call === 0 &&
    inc.missedCall === 0 &&
    inc.quoteReply === 0 &&
    !setCustomerInitiated
  ) {
    return; // nothing to record
  }

  try {
    await tenantTransaction(async (tx) => {
      const existing = await tx.contactEngagementDaily.findUnique({
        where: { orgId_contactId_date: { orgId: input.orgId, contactId: input.contactId, date } },
      });

      const next = {
        inboundMsgCount: (existing?.inboundMsgCount ?? 0) + inc.inboundMsg,
        outboundMsgCount: (existing?.outboundMsgCount ?? 0) + inc.outboundMsg,
        reactionCount: (existing?.reactionCount ?? 0) + inc.reaction,
        mediaShareCount: (existing?.mediaShareCount ?? 0) + inc.mediaShare,
        voiceMsgCount: (existing?.voiceMsgCount ?? 0) + inc.voiceMsg,
        callCount: (existing?.callCount ?? 0) + inc.call,
        missedCallCount: (existing?.missedCallCount ?? 0) + inc.missedCall,
        quoteReplyCount: (existing?.quoteReplyCount ?? 0) + inc.quoteReply,
        customerInitiated: existing?.customerInitiated || setCustomerInitiated,
      };
      const dailyIntensity = computeDailyIntensity(next);

      if (existing) {
        await tx.contactEngagementDaily.update({
          where: { id: existing.id },
          data: { ...next, dailyIntensity },
        });
      } else {
        await tx.contactEngagementDaily.create({
          data: {
            orgId: input.orgId,
            contactId: input.contactId,
            date,
            ...next,
            dailyIntensity,
          },
        });
      }
    }, { timeout: 5000 });
  } catch (err) {
    logger.warn('[engagement] incrementDailyAggregate failed', {
      contactId: input.contactId,
      err: (err as Error).message,
    });
  }
}

/**
 * Check if this is the first inbound message of the day for this contact.
 * Used to set customerInitiated=true only on FIRST inbound (not subsequent).
 */
export async function isFirstInboundToday(contactId: string, at: Date): Promise<boolean> {
  const date = toUtcDay(at);
  const existing = await prisma.contactEngagementDaily.findUnique({
    where: { orgId_contactId_date: { orgId: '__dummy__', contactId, date } },
    select: { inboundMsgCount: true, outboundMsgCount: true },
  }).catch(() => null);
  // First inbound if no prior message today (inbound or outbound)
  return !existing || (existing.inboundMsgCount === 0 && existing.outboundMsgCount === 0);
}

// ════════════════════════════════════════════════════════════════════════
// PATTERN CLASSIFICATION (called from daily cron)
// ════════════════════════════════════════════════════════════════════════

export interface DailyRow {
  date: Date;
  dailyIntensity: number;
}

/**
 * Classify engagement pattern from 28-day window.
 *
 * Window split: last 7 days (current week) vs days 8-14 (previous week).
 * Trend = (currentWeek avg - prevWeek avg) / prevWeek avg * 100, clamped.
 */
export function classifyPattern(
  rows: DailyRow[],
  now: Date = new Date(),
): { pattern: EngagementPattern; trend: number; score: number } {
  if (rows.length === 0) return { pattern: 'noise', trend: 0, score: 0 };

  const today = toUtcDay(now);
  const days = (offset: number) => new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);

  // Bucket: week 0 = current (days 0-6 from today back), week 1 = days 7-13
  const w0Start = days(6).getTime();   // 6 days ago
  const w1Start = days(13).getTime();  // 13 days ago

  let w0Sum = 0, w0Count = 0;
  let w1Sum = 0, w1Count = 0;
  let totalSum = 0;
  let totalActiveDays = 0;
  let totalInteractions = 0;

  for (const r of rows) {
    const ts = toUtcDay(r.date).getTime();
    if (ts >= w0Start) {
      w0Sum += r.dailyIntensity;
      w0Count++;
    } else if (ts >= w1Start) {
      w1Sum += r.dailyIntensity;
      w1Count++;
    }
    totalSum += r.dailyIntensity;
    if (r.dailyIntensity > 0) totalActiveDays++;
    totalInteractions += r.dailyIntensity; // proxy for total event count
  }

  const w0Avg = w0Count > 0 ? w0Sum / 7 : 0;       // divide by 7 (full week)
  const w1Avg = w1Count > 0 ? w1Sum / 7 : 0;
  const avg28 = totalSum / 28;

  // Trend: % change w0 vs w1, clamped -100..200
  let trend = 0;
  if (w1Avg > 0) {
    trend = Math.round(((w0Avg - w1Avg) / w1Avg) * 100);
  } else if (w0Avg > 0) {
    trend = 100; // new activity (from 0 to non-zero)
  }
  trend = Math.max(-100, Math.min(200, trend));

  // Variance: std dev across all rows
  const mean = avg28;
  let variance = 0;
  if (rows.length > 1) {
    let varSum = 0;
    for (const r of rows) varSum += Math.pow(r.dailyIntensity - mean, 2);
    variance = Math.sqrt(varSum / rows.length);
  }

  // Classification logic
  let pattern: EngagementPattern;
  if (totalActiveDays < 3 && totalInteractions < 30) {
    pattern = 'noise';
  } else if (avg28 < 15) {
    pattern = 'cold';
  } else if (trend <= -30) {
    pattern = 'cooling';
  } else if (avg28 >= 75) {
    pattern = 'champion';
  } else if (trend >= 20 && w0Avg >= 40) {
    pattern = 'hot';
  } else {
    pattern = 'stable';
  }

  return {
    pattern,
    trend,
    score: Math.round(avg28),
  };
}

/**
 * Recompute pattern/trend/score for a contact and persist to Contact row.
 * Called from daily cron + can be called on-demand.
 */
export async function recomputeContactEngagement(contactId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const rows = await prisma.contactEngagementDaily.findMany({
    where: { contactId, date: { gte: cutoff } },
    select: { date: true, dailyIntensity: true },
  });

  const result = classifyPattern(rows);

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      engagementPattern: result.pattern,
      engagementTrend: result.trend,
      engagementScore: result.score,
      engagementUpdatedAt: new Date(),
    },
  });

  // Phase 8.C — Recompute Priority Score sau khi engagement đổi (fire-and-forget)
  void (async () => {
    try {
      const { recomputeContactPriority } = await import('./priority-service.js');
      await recomputeContactPriority(contactId);
    } catch {
      /* silent — priority is best-effort */
    }
  })();
}
