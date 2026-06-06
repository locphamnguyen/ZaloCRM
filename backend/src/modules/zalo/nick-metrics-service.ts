/**
 * nick-metrics-service.ts — Phase metrics layer 2026-05-22
 *
 * Per-nick per-day metrics derived from existing tables (Messages + FriendshipAttempt)
 * + thin event log (PhoneSearchEvent). KHÔNG duplicate state vào DailyMessageStat.
 *
 * Xem design doc: ~/.gstack/projects/zalocrm/EVO-THANH-private-hs-design-metrics-20260522-211224.md
 *
 * Caching: in-memory Map TTL 60s. Automation gate có thể bypass với force=true.
 */
import { prisma } from '../../shared/database/prisma-client.js';

export interface NickDayMetrics {
  // Messages
  msgReceivedFromFriends: number;
  msgReceivedFromStrangers: number;
  msgSentByUser: number;
  msgSentByBot: number;
  msgSentTotal: number;
  msgReceivedTotal: number;
  // 2026-06-06 (Anh chốt) — tách tin GỬI ĐI theo bạn/lạ. Cap chỉ áp cho gửi-người-lạ
  // (dailyStrangerMessageCap). Gửi bạn bè + tin nhận KHÔNG tính vào giới hạn.
  msgSentToStrangers: number;
  msgSentToFriends: number;

  // Friend requests (từ FriendshipAttempt)
  friendReqSent: number;
  friendReqAccepted: number;
  friendReqRejected: number;
  friendReqPending: number;
  // 2026-05-28: Split user/bot — TODO schema chưa có FriendshipAttempt.source,
  // tạm tất cả vào byUser, byBot=0 cho tới khi Marketing engine track.
  friendReqByUser: number;
  friendReqByBot: number;

  // Phone search (từ PhoneSearchEvent)
  phoneSearchTotal: number;
  phoneSearchFoundZalo: number;
  phoneSearchNoZalo: number;
  // 2026-05-28: Split via userId NULL/NOT NULL (NULL = automation lookup).
  phoneSearchByUser: number;
  phoneSearchByBot: number;
}

const ZERO_METRICS: NickDayMetrics = {
  msgReceivedFromFriends: 0,
  msgReceivedFromStrangers: 0,
  msgSentByUser: 0,
  msgSentByBot: 0,
  msgSentTotal: 0,
  msgReceivedTotal: 0,
  msgSentToStrangers: 0,
  msgSentToFriends: 0,
  friendReqSent: 0,
  friendReqAccepted: 0,
  friendReqRejected: 0,
  friendReqPending: 0,
  friendReqByUser: 0,
  friendReqByBot: 0,
  phoneSearchTotal: 0,
  phoneSearchFoundZalo: 0,
  phoneSearchNoZalo: 0,
  phoneSearchByUser: 0,
  phoneSearchByBot: 0,
};

// In-memory cache TTL 60s. Key: `${accountId}:${dayUtcMs}`.
// Scale 50 nick × ~10 days history queried = 500 entries max → trivial RAM.
const cache = new Map<string, { metrics: NickDayMetrics; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function cacheKey(accountId: string, dayUtc: Date): string {
  return `${accountId}:${dayUtc.getTime()}`;
}

function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfDayUtc(d: Date): Date {
  const x = startOfDayUtc(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

/**
 * Lấy metrics 1 nick cho 1 ngày UTC.
 * Force=true bypass cache (automation gate cần real-time).
 */
export async function getNickDayMetrics(
  accountId: string,
  dayUtc: Date,
  opts: { force?: boolean } = {},
): Promise<NickDayMetrics> {
  const day = startOfDayUtc(dayUtc);
  const k = cacheKey(accountId, day);
  if (!opts.force) {
    const hit = cache.get(k);
    if (hit && hit.expiresAt > Date.now()) return hit.metrics;
  }

  const dayEnd = endOfDayUtc(day);

  // Query nguồn parallel: messages by category, friendship attempts, phone search,
  // friend-status join, phone search split by userId (manual vs automation).
  const [msgRows, friendReqRows, phoneRows, msgFromFriends, msgFromStrangers, msgSentToStrangers, phoneByUserCount, phoneByBotCount] = await Promise.all([
    // Messages aggregate by (senderType, sentVia)
    prisma.message.groupBy({
      by: ['senderType', 'sentVia'],
      where: {
        conversation: { zaloAccountId: accountId },
        sentAt: { gte: day, lt: dayEnd },
      },
      _count: { _all: true },
    }),

    // FriendshipAttempt state distribution
    prisma.friendshipAttempt.groupBy({
      by: ['state'],
      where: {
        zaloAccountId: accountId,
        // queuedAt là thời điểm tạo attempt — count theo NGÀY tạo (request day).
        queuedAt: { gte: day, lt: dayEnd },
      },
      _count: { _all: true },
    }),

    // PhoneSearchEvent result distribution
    prisma.phoneSearchEvent.groupBy({
      by: ['result'],
      where: {
        accountId,
        occurredAt: { gte: day, lt: dayEnd },
      },
      _count: { _all: true },
    }),

    // Friend/Stranger split: messages received from accepted friends today
    // JOIN: Message → Conversation → Contact → Friend (where status='accepted', accountId=this)
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      INNER JOIN friends f ON f.contact_id = c.contact_id AND f.zalo_account_id = c.zalo_account_id
      WHERE c.zalo_account_id = ${accountId}
        AND m.sender_type = 'contact'
        AND m.sent_at >= ${day}
        AND m.sent_at < ${dayEnd}
        AND f.friendship_status = 'accepted'
    `,

    // Stranger split: received messages WITHOUT accepted friend record
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN friends f ON f.contact_id = c.contact_id
        AND f.zalo_account_id = c.zalo_account_id
        AND f.friendship_status = 'accepted'
      WHERE c.zalo_account_id = ${accountId}
        AND m.sender_type = 'contact'
        AND m.sent_at >= ${day}
        AND m.sent_at < ${dayEnd}
        AND f.id IS NULL
    `,

    // 2026-06-06 (Anh chốt) — tin GỬI ĐI cho NGƯỜI LẠ (self → contact KHÔNG phải bạn accepted).
    // Đây là con số bị cap dailyStrangerMessageCap. Gửi cho bạn bè KHÔNG tính.
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN friends f ON f.contact_id = c.contact_id
        AND f.zalo_account_id = c.zalo_account_id
        AND f.friendship_status = 'accepted'
      WHERE c.zalo_account_id = ${accountId}
        AND m.sender_type = 'self'
        AND m.sent_at >= ${day}
        AND m.sent_at < ${dayEnd}
        AND f.id IS NULL
    `,

    // Phone search split by userId: NULL = automation, NOT NULL = manual user.
    prisma.phoneSearchEvent.count({
      where: { accountId, occurredAt: { gte: day, lt: dayEnd }, userId: { not: null } },
    }),
    prisma.phoneSearchEvent.count({
      where: { accountId, occurredAt: { gte: day, lt: dayEnd }, userId: null },
    }),
  ]);

  const metrics: NickDayMetrics = { ...ZERO_METRICS };

  // Aggregate messages by senderType + sentVia
  for (const r of msgRows) {
    const count = r._count._all;
    if (r.senderType === 'self') {
      if (r.sentVia === 'automation') {
        metrics.msgSentByBot += count;
      } else {
        metrics.msgSentByUser += count;
      }
      metrics.msgSentTotal += count;
    } else if (r.senderType === 'contact') {
      metrics.msgReceivedTotal += count;
    }
  }

  // Friend/Stranger split (raw query returns bigint)
  metrics.msgReceivedFromFriends = Number(msgFromFriends[0]?.count ?? 0n);
  metrics.msgReceivedFromStrangers = Number(msgFromStrangers[0]?.count ?? 0n);
  // 2026-06-06 — tin gửi đi cho người lạ (bị cap) vs bạn bè (không cap).
  metrics.msgSentToStrangers = Number(msgSentToStrangers[0]?.count ?? 0n);
  metrics.msgSentToFriends = Math.max(0, metrics.msgSentTotal - metrics.msgSentToStrangers);

  // FriendshipAttempt state
  for (const r of friendReqRows) {
    const count = r._count._all;
    metrics.friendReqSent += count; // tổng = mọi state attempted
    if (r.state === 'accepted') metrics.friendReqAccepted += count;
    else if (r.state === 'rejected') metrics.friendReqRejected += count;
    else if (r.state === 'sent' || r.state === 'queued' || r.state === 'looked_up') {
      metrics.friendReqPending += count;
    }
  }
  // 2026-05-28: tạm tất cả vào byUser cho tới khi schema có FriendshipAttempt.source.
  // Khi Marketing engine track → migrate sang split thực sự.
  metrics.friendReqByUser = metrics.friendReqSent;
  metrics.friendReqByBot = 0;

  // PhoneSearchEvent
  for (const r of phoneRows) {
    const count = r._count._all;
    metrics.phoneSearchTotal += count;
    if (r.result === 'found_zalo') metrics.phoneSearchFoundZalo += count;
    else if (r.result === 'no_zalo') metrics.phoneSearchNoZalo += count;
  }
  metrics.phoneSearchByUser = phoneByUserCount;
  metrics.phoneSearchByBot = phoneByBotCount;

  cache.set(k, { metrics, expiresAt: Date.now() + CACHE_TTL_MS });
  return metrics;
}

/**
 * Batch query nhiều nicks 1 ngày. Dùng cho /stats endpoint org-wide.
 * Sequential cache check + fallback per-account query (Promise.all).
 */
export async function getNickDayMetricsBatch(
  accountIds: string[],
  dayUtc: Date,
  opts: { force?: boolean } = {},
): Promise<Map<string, NickDayMetrics>> {
  const result = new Map<string, NickDayMetrics>();
  await Promise.all(
    accountIds.map(async (id) => {
      const m = await getNickDayMetrics(id, dayUtc, opts);
      result.set(id, m);
    }),
  );
  return result;
}

/**
 * Aggregate metrics nhiều ngày cho 1 nick (vd 7d sparkline).
 * Sum theo từng metric.
 */
export async function getNickRangeMetrics(
  accountId: string,
  startDayUtc: Date,
  endDayUtcExclusive: Date,
): Promise<NickDayMetrics> {
  const start = startOfDayUtc(startDayUtc);
  const end = startOfDayUtc(endDayUtcExclusive);
  const total: NickDayMetrics = { ...ZERO_METRICS };

  const cursor = new Date(start);
  while (cursor < end) {
    const day = await getNickDayMetrics(accountId, cursor);
    total.msgReceivedFromFriends += day.msgReceivedFromFriends;
    total.msgReceivedFromStrangers += day.msgReceivedFromStrangers;
    total.msgSentByUser += day.msgSentByUser;
    total.msgSentByBot += day.msgSentByBot;
    total.msgSentTotal += day.msgSentTotal;
    total.msgReceivedTotal += day.msgReceivedTotal;
    total.friendReqSent += day.friendReqSent;
    total.friendReqAccepted += day.friendReqAccepted;
    total.friendReqRejected += day.friendReqRejected;
    total.friendReqPending += day.friendReqPending;
    total.phoneSearchTotal += day.phoneSearchTotal;
    total.phoneSearchFoundZalo += day.phoneSearchFoundZalo;
    total.phoneSearchNoZalo += day.phoneSearchNoZalo;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

/**
 * Invalidate cache cho 1 account 1 day. Gọi khi vừa insert Message / FriendshipAttempt /
 * PhoneSearchEvent cho real-time accuracy (vẫn fallback 60s nếu writer miss).
 */
export function invalidateMetricsCache(accountId: string, dayUtc: Date): void {
  cache.delete(cacheKey(accountId, startOfDayUtc(dayUtc)));
}

/** Clear toàn cache. Cho test + emergency. */
export function clearMetricsCache(): void {
  cache.clear();
}
