// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M6 — Stats Dashboard Wave A endpoints (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// 2 endpoint Wave A theo Section 23.4 design doc:
//   GET /api/v1/automation/sequences/:id/stats/overview (60s cache)
//   GET /api/v1/automation/sequences/:id/stats/outcomes?range=7d|30d (5min cache)
//
// Filter (Issue #3 3A): default WHERE NOT isSystemTrigger + toggle "include manual"
//
// Cache: in-memory Map với TTL stamp. Production có thể nâng cấp Redis nhưng
// Map đủ cho 50 nick × 25 sale × ít sequence (~10-20 sequence active).
//
// Auth: tất cả endpoint require authMiddleware (memory auth_missing_trap warning).

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { authMiddleware } from '../../auth/auth-middleware.js';

// ════════════════════════════════════════════════════════════════════════
// In-memory cache với TTL
// ════════════════════════════════════════════════════════════════════════
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ════════════════════════════════════════════════════════════════════════
// Stats helpers
// ════════════════════════════════════════════════════════════════════════
interface OverviewStats {
  sequenceId: string;
  sequenceName: string;
  enrolledTotal: number;
  enrolledCached: number;
  completedTotal: number;
  completedCached: number;
  blockCount: number;
  replyCount: number;
  enroll24h: number;
  enroll7d: number;
  enroll30d: number;
  sentMessagesTotal: number;
  countersLastSyncedAt: Date | null;
  includeSystemTrigger: boolean;
}

async function buildOverview(
  sequenceId: string,
  orgId: string,
  includeSystem: boolean,
): Promise<OverviewStats> {
  const sequence = await prisma.automationSequence.findFirst({
    where: { id: sequenceId, orgId },
    select: {
      id: true,
      name: true,
      enrolledCountCached: true,
      completedCountCached: true,
      blockCountCached: true,
      replyCountCached: true,
      countersLastSyncedAt: true,
    },
  });

  if (!sequence) {
    throw new Error('sequence_not_found');
  }

  // Find triggers linked to this sequence (filter system)
  const triggers = await prisma.automationTrigger.findMany({
    where: {
      orgId,
      OR: [{ sequenceId }, { successorSequenceId: sequenceId }],
      ...(includeSystem ? {} : { isSystemTrigger: false }),
    },
    select: { id: true },
  });
  const triggerIds = triggers.map((t) => t.id);

  if (triggerIds.length === 0) {
    return {
      sequenceId,
      sequenceName: sequence.name,
      enrolledTotal: 0,
      enrolledCached: sequence.enrolledCountCached,
      completedTotal: 0,
      completedCached: sequence.completedCountCached,
      blockCount: sequence.blockCountCached,
      replyCount: sequence.replyCountCached,
      enroll24h: 0,
      enroll7d: 0,
      enroll30d: 0,
      sentMessagesTotal: 0,
      countersLastSyncedAt: sequence.countersLastSyncedAt,
      includeSystemTrigger: includeSystem,
    };
  }

  const now = new Date();
  const ago24h = new Date(now.getTime() - 86400_000);
  const ago7d = new Date(now.getTime() - 7 * 86400_000);
  const ago30d = new Date(now.getTime() - 30 * 86400_000);

  // Count event logs by type cho sequence này
  const [enrolled24h, enrolled7d, enrolled30d, sentMessages, replyCount, blockCount] = await Promise.all([
    prisma.automationEventLog.count({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_enqueued',
        detail: { contains: 'step 0/' },
        createdAt: { gte: ago24h },
      },
    }),
    prisma.automationEventLog.count({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_enqueued',
        detail: { contains: 'step 0/' },
        createdAt: { gte: ago7d },
      },
    }),
    prisma.automationEventLog.count({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_enqueued',
        detail: { contains: 'step 0/' },
        createdAt: { gte: ago30d },
      },
    }),
    prisma.automationEventLog.count({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_sent',
      },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'customer_reply' },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'customer_block' },
    }),
  ]);

  return {
    sequenceId,
    sequenceName: sequence.name,
    enrolledTotal: enrolled30d,
    enrolledCached: sequence.enrolledCountCached,
    completedTotal: 0, // M7 funnel sẽ tính
    completedCached: sequence.completedCountCached,
    blockCount,
    replyCount,
    enroll24h: enrolled24h,
    enroll7d: enrolled7d,
    enroll30d: enrolled30d,
    sentMessagesTotal: sentMessages,
    countersLastSyncedAt: sequence.countersLastSyncedAt,
    includeSystemTrigger: includeSystem,
  };
}

interface OutcomeStats {
  sequenceId: string;
  range: '24h' | '7d' | '30d';
  totalEnrolled: number;
  totalSent: number;
  reply: number;
  reactionPositive: number;
  reactionNegative: number;
  block: number;
  friendAccept: number;
  friendReject: number;
  rates: {
    replyRate: number;
    positiveReactionRate: number;
    negativeReactionRate: number;
    blockRate: number;
  };
}

async function buildOutcomes(
  sequenceId: string,
  orgId: string,
  range: '24h' | '7d' | '30d',
  includeSystem: boolean,
): Promise<OutcomeStats> {
  const ms = range === '24h' ? 86400_000 : range === '7d' ? 7 * 86400_000 : 30 * 86400_000;
  const since = new Date(Date.now() - ms);

  const triggers = await prisma.automationTrigger.findMany({
    where: {
      orgId,
      OR: [{ sequenceId }, { successorSequenceId: sequenceId }],
      ...(includeSystem ? {} : { isSystemTrigger: false }),
    },
    select: { id: true },
  });
  const triggerIds = triggers.map((t) => t.id);

  if (triggerIds.length === 0) {
    return {
      sequenceId,
      range,
      totalEnrolled: 0,
      totalSent: 0,
      reply: 0,
      reactionPositive: 0,
      reactionNegative: 0,
      block: 0,
      friendAccept: 0,
      friendReject: 0,
      rates: { replyRate: 0, positiveReactionRate: 0, negativeReactionRate: 0, blockRate: 0 },
    };
  }

  const [enrolled, sent, reply, reactPositive, reactNegative, block, accept, reject] = await Promise.all([
    prisma.automationEventLog.count({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_enqueued',
        detail: { contains: 'step 0/' },
        createdAt: { gte: since },
      },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'sequence_step_sent', createdAt: { gte: since } },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'customer_reply', createdAt: { gte: since } },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'customer_reaction_positive', createdAt: { gte: since } },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'customer_reaction_negative', createdAt: { gte: since } },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'customer_block', createdAt: { gte: since } },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'friend_accepted', createdAt: { gte: since } },
    }),
    prisma.automationEventLog.count({
      where: { triggerId: { in: triggerIds }, eventType: 'friend_rejected', createdAt: { gte: since } },
    }),
  ]);

  const denom = Math.max(enrolled, 1);
  return {
    sequenceId,
    range,
    totalEnrolled: enrolled,
    totalSent: sent,
    reply,
    reactionPositive: reactPositive,
    reactionNegative: reactNegative,
    block,
    friendAccept: accept,
    friendReject: reject,
    rates: {
      replyRate: +((reply / denom) * 100).toFixed(2),
      positiveReactionRate: +((reactPositive / denom) * 100).toFixed(2),
      negativeReactionRate: +((reactNegative / denom) * 100).toFixed(2),
      blockRate: +((block / denom) * 100).toFixed(2),
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// Wave B — Funnel per-step + skip breakdown
// ════════════════════════════════════════════════════════════════════════
interface FunnelStep {
  stepIdx: number;
  entered: number;
  sent: number;
  skipped: number;
  failed: number;
  replied: number;
  dropOffPct: number;
}

async function buildFunnel(
  sequenceId: string,
  orgId: string,
  range: '7d' | '30d',
  includeSystem: boolean,
): Promise<{ sequenceId: string; range: string; steps: FunnelStep[]; totalSteps: number }> {
  const ms = range === '7d' ? 7 * 86400_000 : 30 * 86400_000;
  const since = new Date(Date.now() - ms);

  const sequence = await prisma.automationSequence.findFirst({
    where: { id: sequenceId, orgId },
    select: { id: true, steps: true },
  });
  if (!sequence) throw new Error('sequence_not_found');

  const totalSteps = Array.isArray(sequence.steps)
    ? (sequence.steps as unknown[]).length
    : 0;

  const triggers = await prisma.automationTrigger.findMany({
    where: {
      orgId,
      OR: [{ sequenceId }, { successorSequenceId: sequenceId }],
      ...(includeSystem ? {} : { isSystemTrigger: false }),
    },
    select: { id: true },
  });
  const triggerIds = triggers.map((t) => t.id);

  if (triggerIds.length === 0 || totalSteps === 0) {
    return { sequenceId, range, steps: [], totalSteps };
  }

  // Query event logs grouped by step idx (parse from detail "step N/M")
  const events = await prisma.automationEventLog.findMany({
    where: {
      triggerId: { in: triggerIds },
      eventType: { in: ['sequence_step_sent', 'sequence_step_failed', 'sequence_step_enqueued'] },
      createdAt: { gte: since },
    },
    select: { eventType: true, detail: true, contactId: true },
  });

  // Tally per-step counts
  const stepData = new Map<number, {
    sent: Set<string>;
    failed: Set<string>;
    enqueued: Set<string>;
  }>();
  for (let i = 0; i < totalSteps; i++) {
    stepData.set(i, { sent: new Set(), failed: new Set(), enqueued: new Set() });
  }

  for (const e of events) {
    const m = e.detail?.match(/step (\d+)\/\d+/);
    if (!m || !e.contactId) continue;
    const stepIdx = parseInt(m[1], 10);
    const bucket = stepData.get(stepIdx);
    if (!bucket) continue;

    if (e.eventType === 'sequence_step_sent') bucket.sent.add(e.contactId);
    else if (e.eventType === 'sequence_step_failed') bucket.failed.add(e.contactId);
    else if (e.eventType === 'sequence_step_enqueued') bucket.enqueued.add(e.contactId);
  }

  // Replied per-step: count customer_reply events within 48h sau step_sent (approx)
  const replyEvents = await prisma.automationEventLog.findMany({
    where: {
      triggerId: { in: triggerIds },
      eventType: 'customer_reply',
      createdAt: { gte: since },
    },
    select: { contactId: true, createdAt: true },
  });
  const replyContactSet = new Set(replyEvents.map((r) => r.contactId).filter(Boolean) as string[]);

  // Build steps array
  const stepArr: FunnelStep[] = [];
  let prevEntered = 0;
  for (let i = 0; i < totalSteps; i++) {
    const bucket = stepData.get(i)!;
    const entered = bucket.enqueued.size;
    const sent = bucket.sent.size;
    const failed = bucket.failed.size;
    const skipped = Math.max(0, entered - sent - failed);
    // Count replies per step: approximate intersect contactId of sent step + reply existing
    const replied = [...bucket.sent].filter((cid) => replyContactSet.has(cid)).length;

    const dropOffPct = i === 0 ? 0 : prevEntered > 0
      ? +(((prevEntered - entered) / prevEntered) * 100).toFixed(1)
      : 0;

    stepArr.push({ stepIdx: i, entered, sent, skipped, failed, replied, dropOffPct });
    prevEntered = entered;
  }

  return { sequenceId, range, steps: stepArr, totalSteps };
}

interface SkipBreakdown {
  stepIdx: number;
  reasons: Array<{ reason: string; count: number; category: string }>;
}

async function buildSkipBreakdown(
  sequenceId: string,
  stepIdx: number,
  orgId: string,
  includeSystem: boolean,
): Promise<SkipBreakdown> {
  const since = new Date(Date.now() - 7 * 86400_000);

  const triggers = await prisma.automationTrigger.findMany({
    where: {
      orgId,
      OR: [{ sequenceId }, { successorSequenceId: sequenceId }],
      ...(includeSystem ? {} : { isSystemTrigger: false }),
    },
    select: { id: true },
  });
  const triggerIds = triggers.map((t) => t.id);

  if (triggerIds.length === 0) return { stepIdx, reasons: [] };

  // Sequence_step_failed events at this stepIdx — parse skipReason từ detail
  const events = await prisma.automationEventLog.findMany({
    where: {
      triggerId: { in: triggerIds },
      eventType: 'sequence_step_failed',
      detail: { contains: `step ${stepIdx}/` },
      createdAt: { gte: since },
    },
    select: { detail: true },
    take: 1000,
  });

  // Parse failure reasons (Section 23.3 categorize)
  const reasonMap = new Map<string, number>();
  for (const e of events) {
    // Detail format: "step N/M code=X msg=..."
    const m = e.detail?.match(/code=([^ ]+)/);
    const reason = m?.[1] ?? 'unknown';
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
  }

  const reasons = [...reasonMap.entries()].map(([reason, count]) => ({
    reason,
    count,
    category: categorizeSkipReason(reason),
  }));
  reasons.sort((a, b) => b.count - a.count);

  return { stepIdx, reasons };
}

function categorizeSkipReason(reason: string): string {
  const benign = ['already_friend', 'no_zalo', 'stop_on_accept'];
  const throttle = ['hour_window', 'nick_gap', 'cross_nick_recency'];
  const capacity = ['quota_capped', 'cap_message', 'cap_friend_add'];
  const config = ['block_archived', 'block_not_found', 'rule_disabled', 'sequence_disabled', 'trigger_not_found'];

  if (benign.some((k) => reason.includes(k))) return 'benign';
  if (throttle.some((k) => reason.includes(k))) return 'throttle';
  if (capacity.some((k) => reason.includes(k))) return 'capacity';
  if (config.some((k) => reason.includes(k))) return 'config_error';
  return 'unknown';
}

// ════════════════════════════════════════════════════════════════════════
// Wave C — Health + per-nick + alert
// ════════════════════════════════════════════════════════════════════════
interface HealthStats {
  sequenceId: string;
  workerHeartbeatSec: number; // approx, từ latest sequence_step_sent
  stuckTaskCount: number;     // event log step_enqueued không có step_sent follow-up
  failedRate24h: number;      // %
  failedCount24h: number;
  totalFinished24h: number;
  skipReasonBreakdown24h: Array<{ category: string; count: number }>;
  alertLevel: 'green' | 'yellow' | 'red';
  alerts: string[];
}

async function buildHealth(
  sequenceId: string,
  orgId: string,
  includeSystem: boolean,
): Promise<HealthStats> {
  const since24h = new Date(Date.now() - 86400_000);
  const sinceStuck = new Date(Date.now() - 30 * 60_000);

  const triggers = await prisma.automationTrigger.findMany({
    where: {
      orgId,
      OR: [{ sequenceId }, { successorSequenceId: sequenceId }],
      ...(includeSystem ? {} : { isSystemTrigger: false }),
    },
    select: { id: true },
  });
  const triggerIds = triggers.map((t) => t.id);

  if (triggerIds.length === 0) {
    return {
      sequenceId,
      workerHeartbeatSec: -1,
      stuckTaskCount: 0,
      failedRate24h: 0,
      failedCount24h: 0,
      totalFinished24h: 0,
      skipReasonBreakdown24h: [],
      alertLevel: 'green',
      alerts: [],
    };
  }

  const [latestSent, failed24h, sent24h, allFailures24h] = await Promise.all([
    prisma.automationEventLog.findFirst({
      where: { triggerId: { in: triggerIds }, eventType: 'sequence_step_sent' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.automationEventLog.count({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_failed',
        createdAt: { gte: since24h },
      },
    }),
    prisma.automationEventLog.count({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_sent',
        createdAt: { gte: since24h },
      },
    }),
    prisma.automationEventLog.findMany({
      where: {
        triggerId: { in: triggerIds },
        eventType: 'sequence_step_failed',
        createdAt: { gte: since24h },
      },
      select: { detail: true },
      take: 500,
    }),
  ]);

  const heartbeatSec = latestSent
    ? Math.floor((Date.now() - latestSent.createdAt.getTime()) / 1000)
    : -1;

  // Stuck tasks: step_enqueued > 30 phút mà chưa có step_sent với same step idx
  const recentEnqueued = await prisma.automationEventLog.findMany({
    where: {
      triggerId: { in: triggerIds },
      eventType: 'sequence_step_enqueued',
      createdAt: { lt: sinceStuck, gte: since24h },
    },
    select: { contactId: true, detail: true, createdAt: true },
    take: 500,
  });

  let stuckCount = 0;
  for (const enq of recentEnqueued) {
    const m = enq.detail?.match(/step (\d+)\/(\d+)/);
    if (!m || !enq.contactId) continue;
    const stepIdx = parseInt(m[1], 10);

    const sentFollowup = await prisma.automationEventLog.findFirst({
      where: {
        triggerId: { in: triggerIds },
        contactId: enq.contactId,
        eventType: 'sequence_step_sent',
        detail: { contains: `step ${stepIdx}/` },
        createdAt: { gte: enq.createdAt },
      },
      select: { id: true },
    });
    if (!sentFollowup) stuckCount++;
  }

  // Failed rate (sample gate 20)
  const totalFinished = sent24h + failed24h;
  const failedRate = totalFinished >= 20
    ? +((failed24h / totalFinished) * 100).toFixed(1)
    : 0;

  // Skip reason breakdown by category
  const categoryCounts = new Map<string, number>();
  for (const e of allFailures24h) {
    const m = e.detail?.match(/code=([^ ]+)/);
    const reason = m?.[1] ?? 'unknown';
    const cat = categorizeSkipReason(reason);
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }
  const skipBreakdown = [...categoryCounts.entries()].map(([category, count]) => ({
    category,
    count,
  }));

  // Alert logic
  const alerts: string[] = [];
  let alertLevel: 'green' | 'yellow' | 'red' = 'green';

  if (stuckCount > 5) {
    alerts.push(`${stuckCount} task kẹt cứng quá 30 phút — nghi worker treo`);
    alertLevel = 'red';
  } else if (stuckCount > 0) {
    alerts.push(`${stuckCount} task chờ pickup > 30 phút`);
    alertLevel = 'yellow';
  }

  if (failedRate >= 20) {
    alerts.push(`Tỷ lệ fail 24h: ${failedRate}% — cao bất thường`);
    alertLevel = 'red';
  } else if (failedRate >= 10) {
    alerts.push(`Tỷ lệ fail 24h: ${failedRate}%`);
    if (alertLevel === 'green') alertLevel = 'yellow';
  }

  if (heartbeatSec > 600 && totalFinished > 0) {
    alerts.push(`Worker heartbeat > 10 phút — có thể đang stuck`);
    alertLevel = 'red';
  }

  return {
    sequenceId,
    workerHeartbeatSec: heartbeatSec,
    stuckTaskCount: stuckCount,
    failedRate24h: failedRate,
    failedCount24h: failed24h,
    totalFinished24h: totalFinished,
    skipReasonBreakdown24h: skipBreakdown,
    alertLevel,
    alerts,
  };
}

interface NickHealthStats {
  nickId: string;
  nickName: string;
  attempts24h: number;
  failed24h: number;
  errorRate: number;
  capUsed: number;
  capLimit: number;
  capPct: number;
  status: string;
}

async function buildNickHealth(
  sequenceId: string,
  orgId: string,
  includeSystem: boolean,
): Promise<NickHealthStats[]> {
  const since = new Date(Date.now() - 86400_000);

  const triggers = await prisma.automationTrigger.findMany({
    where: {
      orgId,
      OR: [{ sequenceId }, { successorSequenceId: sequenceId }],
      ...(includeSystem ? {} : { isSystemTrigger: false }),
    },
    select: { id: true },
  });
  const triggerIds = triggers.map((t) => t.id);

  if (triggerIds.length === 0) return [];

  // Group event logs by nickId in last 24h
  const events = await prisma.automationEventLog.findMany({
    where: {
      triggerId: { in: triggerIds },
      eventType: { in: ['sequence_step_sent', 'sequence_step_failed'] },
      createdAt: { gte: since },
      nickId: { not: null },
    },
    select: { nickId: true, eventType: true },
  });

  const nickStats = new Map<string, { sent: number; failed: number }>();
  for (const e of events) {
    if (!e.nickId) continue;
    const stat = nickStats.get(e.nickId) ?? { sent: 0, failed: 0 };
    if (e.eventType === 'sequence_step_sent') stat.sent++;
    else stat.failed++;
    nickStats.set(e.nickId, stat);
  }

  // Load nick info + cap
  const nickIds = [...nickStats.keys()];
  if (nickIds.length === 0) return [];

  const nicks = await prisma.zaloAccount.findMany({
    where: { id: { in: nickIds }, orgId },
    select: { id: true, displayName: true, dailyMessageCap: true, status: true },
  });

  const result: NickHealthStats[] = nicks
    .map((n) => {
      const stat = nickStats.get(n.id) ?? { sent: 0, failed: 0 };
      const attempts = stat.sent + stat.failed;
      const errorRate = attempts >= 10
        ? +((stat.failed / attempts) * 100).toFixed(1)
        : 0;
      const capPct = n.dailyMessageCap > 0
        ? +((stat.sent / n.dailyMessageCap) * 100).toFixed(1)
        : 0;
      return {
        nickId: n.id,
        nickName: n.displayName ?? n.id,
        attempts24h: attempts,
        failed24h: stat.failed,
        errorRate,
        capUsed: stat.sent,
        capLimit: n.dailyMessageCap,
        capPct,
        status: n.status,
      };
    })
    .filter((s) => s.attempts24h >= 10)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10);

  return result;
}

// ════════════════════════════════════════════════════════════════════════
// Route registration
// ════════════════════════════════════════════════════════════════════════
export async function registerSequenceStatsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/automation/sequences/:id/stats/overview
  app.get<{
    Params: { id: string };
    Querystring: { includeSystemTrigger?: string };
  }>(
    '/api/v1/automation/sequences/:id/stats/overview',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const includeSystem = request.query.includeSystemTrigger === 'true';
      const orgId = request.user!.orgId;
      const cacheKey = `overview:${orgId}:${id}:${includeSystem}`;

      const cached = getCached<OverviewStats>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }

      try {
        const data = await buildOverview(id, orgId, includeSystem);
        setCached(cacheKey, data, 60_000); // 60s
        reply.header('X-Cache', 'MISS');
        return data;
      } catch (err) {
        if ((err as Error).message === 'sequence_not_found') {
          reply.code(404);
          return { error: 'Sequence không tồn tại' };
        }
        logger.error(`[stats/overview] error: ${(err as Error).message}`);
        reply.code(500);
        return { error: 'Lỗi máy chủ' };
      }
    },
  );

  // GET /api/v1/automation/sequences/:id/stats/outcomes?range=7d|30d
  app.get<{
    Params: { id: string };
    Querystring: { range?: string; includeSystemTrigger?: string };
  }>(
    '/api/v1/automation/sequences/:id/stats/outcomes',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const rangeRaw = request.query.range ?? '7d';
      const range: '24h' | '7d' | '30d' = (['24h', '7d', '30d'] as const).includes(rangeRaw as '24h' | '7d' | '30d')
        ? (rangeRaw as '24h' | '7d' | '30d')
        : '7d';
      const includeSystem = request.query.includeSystemTrigger === 'true';
      const orgId = request.user!.orgId;
      const cacheKey = `outcomes:${orgId}:${id}:${range}:${includeSystem}`;

      const cached = getCached<OutcomeStats>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }

      try {
        const data = await buildOutcomes(id, orgId, range, includeSystem);
        setCached(cacheKey, data, 5 * 60_000); // 5min
        reply.header('X-Cache', 'MISS');
        return data;
      } catch (err) {
        logger.error(`[stats/outcomes] error: ${(err as Error).message}`);
        reply.code(500);
        return { error: 'Lỗi máy chủ' };
      }
    },
  );

  // ── Wave B — Funnel per-step + drill-down skip breakdown ──
  app.get<{
    Params: { id: string };
    Querystring: { range?: string; includeSystemTrigger?: string };
  }>(
    '/api/v1/automation/sequences/:id/stats/funnel',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const range: '7d' | '30d' = request.query.range === '30d' ? '30d' : '7d';
      const includeSystem = request.query.includeSystemTrigger === 'true';
      const orgId = request.user!.orgId;
      const cacheKey = `funnel:${orgId}:${id}:${range}:${includeSystem}`;

      const cached = getCached<unknown>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }

      try {
        const data = await buildFunnel(id, orgId, range, includeSystem);
        setCached(cacheKey, data, 60_000); // 60s
        reply.header('X-Cache', 'MISS');
        return data;
      } catch (err) {
        if ((err as Error).message === 'sequence_not_found') {
          reply.code(404);
          return { error: 'Sequence không tồn tại' };
        }
        logger.error(`[stats/funnel] error: ${(err as Error).message}`);
        reply.code(500);
        return { error: 'Lỗi máy chủ' };
      }
    },
  );

  app.get<{
    Params: { id: string; stepIdx: string };
    Querystring: { includeSystemTrigger?: string };
  }>(
    '/api/v1/automation/sequences/:id/stats/funnel/:stepIdx/skip-breakdown',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id, stepIdx } = request.params;
      const stepIdxNum = parseInt(stepIdx, 10);
      if (isNaN(stepIdxNum)) {
        reply.code(400);
        return { error: 'stepIdx phải là số' };
      }
      const includeSystem = request.query.includeSystemTrigger === 'true';
      const orgId = request.user!.orgId;

      try {
        const data = await buildSkipBreakdown(id, stepIdxNum, orgId, includeSystem);
        return data;
      } catch (err) {
        logger.error(`[stats/skip-breakdown] error: ${(err as Error).message}`);
        reply.code(500);
        return { error: 'Lỗi máy chủ' };
      }
    },
  );

  // ── Wave C — Health + per-nick ──
  app.get<{
    Params: { id: string };
    Querystring: { includeSystemTrigger?: string };
  }>(
    '/api/v1/automation/sequences/:id/stats/health',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const includeSystem = request.query.includeSystemTrigger === 'true';
      const orgId = request.user!.orgId;
      const cacheKey = `health:${orgId}:${id}:${includeSystem}`;

      const cached = getCached<HealthStats>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }

      try {
        const data = await buildHealth(id, orgId, includeSystem);
        setCached(cacheKey, data, 30_000); // 30s (Issue #11 11A)
        reply.header('X-Cache', 'MISS');
        return data;
      } catch (err) {
        logger.error(`[stats/health] error: ${(err as Error).message}`);
        reply.code(500);
        return { error: 'Lỗi máy chủ' };
      }
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { includeSystemTrigger?: string };
  }>(
    '/api/v1/automation/sequences/:id/stats/health/nicks',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const includeSystem = request.query.includeSystemTrigger === 'true';
      const orgId = request.user!.orgId;
      const cacheKey = `health:nicks:${orgId}:${id}:${includeSystem}`;

      const cached = getCached<NickHealthStats[]>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }

      try {
        const data = await buildNickHealth(id, orgId, includeSystem);
        setCached(cacheKey, data, 30_000); // 30s
        reply.header('X-Cache', 'MISS');
        return data;
      } catch (err) {
        logger.error(`[stats/health/nicks] error: ${(err as Error).message}`);
        reply.code(500);
        return { error: 'Lỗi máy chủ' };
      }
    },
  );

  // POST /api/v1/automation/sequences/stats/reconcile-counters (admin only)
  // Manual trigger reconcile drift cho all sequences trong org
  app.post(
    '/api/v1/automation/sequences/stats/reconcile-counters',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdmin = user?.role === 'owner' || user?.role === 'admin';
      if (!isAdmin) {
        reply.code(403);
        return { error: 'Chỉ Owner + Admin được manual reconcile' };
      }

      const { manualReconcile } = await import('../queues/stats-reconcile-cron.js');
      const result = await manualReconcile();
      return result;
    },
  );

  logger.info('[stats-routes] registered 7 endpoints (Wave A + B + C + reconcile)');
}
