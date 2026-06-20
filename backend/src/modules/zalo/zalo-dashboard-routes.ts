// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Zalo Accounts Dashboard routes — KPI stats, enriched list, bulk actions, uptime sparklines.
 *
 * Endpoints:
 *   GET  /api/v1/zalo-accounts/stats          — team KPI (total/active/idle/error/msgToday/uptimeTeam)
 *   GET  /api/v1/zalo-accounts/enriched       — list + per-account metrics for dashboard table
 *   GET  /api/v1/zalo-accounts/:id/uptime     — 7-day activity sparkline
 *   POST /api/v1/zalo-accounts/bulk-action    — { ids[], action: 'reconnect'|'sync-contacts'|'disable' }
 *
 * Uptime in v1 is derived from DailyMessageStat (days with activity / 7) — it's a "usage rate"
 * proxy, not a strict connection uptime. A future ZaloAccountStatusLog table can replace this.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { zaloPool } from './zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import { getZaloScope, canManageAccount, requireAccountVisible } from './zalo-scope.js';
import { uptimeWindowBatch } from './status-log-service.js';
import { revokeAllSessions } from '../privacy/session-service.js';
import { getNickDayMetricsBatch, type NickDayMetrics } from './nick-metrics-service.js';
import { ALL_CATEGORIES, DEFAULT_SDK_LIMITS, invalidateLimitCache } from './sdk-limit-service.js';
import { zaloRateLimiter } from './zalo-rate-limiter.js';

const DAILY_QUOTA = 500; // per-nick soft cap shown in UI (msg today X / 500)

/** UTC start of "today" relative to the given date. We store DailyMessageStat at @db.Date. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** Range of N days ending today (inclusive). Returns ISO date strings YYYY-MM-DD. */
function lastNDays(n: number): { start: Date; days: string[] } {
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const days: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return { start, days };
}

export async function zaloDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ───────────────────────────────────────────────────────────────────
  // GET /api/v1/zalo-accounts/stats — team-level KPI for header cards
  // ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/zalo-accounts/stats', async (request) => {
    const user = request.user!;
    const userId = (user as any).userId ?? user.id;
    const today = startOfDay(new Date());

    // RBAC scope 2026-05-22: stats chỉ tính trên nicks user được thấy.
    const scope = await getZaloScope(userId, user.orgId, user.role);

    // 2026-06-10 FIX: KPI không đếm nick đã xóa mềm (archivedAt) — đồng bộ enriched/list.
    const accounts = await prisma.zaloAccount.findMany({
      // FIX: bỏ nick đã xoá mềm khỏi KPI (total/active/re-login) — đồng bộ enriched/list.
      where: { orgId: user.orgId, id: { in: scope.accessibleIds }, archivedAt: null },
      select: { id: true, status: true, lastConnectedAt: true },
    });
    const accountIds = accounts.map((a) => a.id);

    // Phase metrics layer 2026-05-22: dùng nick-metrics-service thay vì DailyMessageStat
    // (bảng cũ KHÔNG có writer code → dead). Today metrics + uptime cùng batch query.
    const [metricsToday, metricsYesterday, uptimeMap] = await Promise.all([
      getNickDayMetricsBatch(accountIds, today),
      getNickDayMetricsBatch(accountIds, new Date(today.getTime() - 86400_000)),
      uptimeWindowBatch(accountIds, 7),
    ]);

    // Active = connected + có activity 24h (today + yesterday có msg sent/received).
    const activeRecent = new Set<string>();
    for (const id of accountIds) {
      const t = metricsToday.get(id);
      const y = metricsYesterday.get(id);
      const total24h = (t?.msgSentTotal ?? 0) + (t?.msgReceivedTotal ?? 0)
        + (y?.msgSentTotal ?? 0) + (y?.msgReceivedTotal ?? 0);
      if (total24h > 0) activeRecent.add(id);
    }

    let totalNick = accounts.length;
    let active = 0;
    let idle = 0;
    let error = 0;
    let uptimeSum = 0;
    const needReloginIds: string[] = [];

    for (const a of accounts) {
      const live = zaloPool.getStatus(a.id) ?? a.status;
      const u = uptimeMap.get(a.id);
      uptimeSum += u?.uptimePct ?? 0;

      if (live === 'connected') {
        if (activeRecent.has(a.id)) active++;
        else idle++;
      } else {
        error++;
        needReloginIds.push(a.id);
      }
    }

    // msgToday = SUM toàn org cho today (gồm cả sent + received)
    let msgToday = 0;
    let msgSentByBot = 0;
    let phoneSearchTotal = 0;
    let friendReqSent = 0;
    for (const id of accountIds) {
      const m = metricsToday.get(id);
      if (!m) continue;
      msgToday += m.msgSentTotal + m.msgReceivedTotal;
      msgSentByBot += m.msgSentByBot;
      phoneSearchTotal += m.phoneSearchTotal;
      friendReqSent += m.friendReqSent;
    }
    const quota = totalNick * DAILY_QUOTA;
    const uptimeTeam = totalNick > 0 ? uptimeSum / totalNick : 0;

    return {
      totalNick,
      active,
      idle,
      error,
      msgToday,
      msgSentByBot,
      phoneSearchTotal,
      friendReqSent,
      quota,
      uptimeTeam: Number(uptimeTeam.toFixed(1)),
      needReloginIds,
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /api/v1/zalo-accounts/enriched — list + per-account metrics
  // Replaces /zalo-accounts for dashboard view (includes crew, msgToday, uptime, lastActivity)
  // ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/zalo-accounts/enriched', async (request) => {
    const user = request.user!;
    const userId = (user as any).userId ?? user.id;
    const today = startOfDay(new Date());

    // RBAC scope 2026-05-22: chỉ trả nicks user được phép xem.
    const scope = await getZaloScope(userId, user.orgId, user.role);

    // FIX: endpoint enriched (grid card) ẩn nick đã xoá mềm như GET /zalo-accounts.
    // Bug cũ: enriched thiếu archivedAt:null → xoá nick xong vẫn hiện (tab Đơn giản/Nâng cao)
    // + zombie qr_pending. ?includeArchived=true để admin xem lại nick đã xoá (khôi phục).
    const includeArchived = (request.query as Record<string, string>)?.includeArchived === 'true';

    const accounts = await prisma.zaloAccount.findMany({
      where: {
        orgId: user.orgId,
        id: { in: scope.accessibleIds },
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        ownerUserId: true,
        privacyMode: true,
        proxyUrl: true,
        lastConnectedAt: true,
        disconnectedAt: true,      // 2026-06-16: mốc mất kết nối (FE đếm/hiển thị)
        disconnectReason: true,    // 'manual' | 'passive' | null
        createdAt: true,
        // 2026-06-06 — cap tin gửi người lạ (Msg today so với cap này, KHÔNG phải 500 cũ).
        dailyStrangerMessageCap: true,
        // Phase 4 redesign 2026-05-22: include owner's department để FE hiển thị
        // cột Department + cascade visibility filter chip "Phòng ban".
        // Phase Privacy v2 2026-05-23: include reverse "internalContactForUsers" để show
        // badge "🏠 Liên lạc nội bộ" trong AccountsTable owner cell.
        owner: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentMember: {
              select: {
                deptRole: true,
                department: { select: { id: true, name: true, path: true } },
              },
            },
          },
        },
        // Users đang dùng nick này làm internal contact (thường 0-1 user)
        internalContactForUsers: { select: { id: true, fullName: true } },
        access: {
          select: {
            id: true,
            permission: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) return [];

    // Phase metrics layer 2026-05-22: msgToday + uptime7d cùng batch query.
    // KHÔNG dùng DailyMessageStat nữa (dead writer). lastActivity derive từ Message table.
    const [metricsToday, uptimeMap, lastMsgRows] = await Promise.all([
      getNickDayMetricsBatch(ids, today),
      uptimeWindowBatch(ids, 7),
      // Last message sentAt per account (proxy lastActivity)
      prisma.$queryRaw<Array<{ account_id: string; last_at: Date }>>`
        SELECT c.zalo_account_id as account_id, MAX(m.sent_at) as last_at
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.zalo_account_id = ANY(${ids}::text[])
        GROUP BY c.zalo_account_id
      `,
    ]);

    const lastActivityMap = new Map<string, Date>(
      lastMsgRows.map((r) => [r.account_id, r.last_at]),
    );

    // 2026-06-06 — SDK counts per-nick (Redis rate-limiter) cho bảng ma trận:
    // tổng lượt SDK + từng category + số lần đồng bộ danh bạ.
    const sdkCountsMap = new Map<string, Record<string, number>>();
    const contactSyncMap = new Map<string, number>();
    await Promise.all(ids.map(async (nid) => {
      const counts = await zaloRateLimiter.getAllDailyCounts(nid);
      sdkCountsMap.set(nid, counts);
      contactSyncMap.set(nid, await zaloRateLimiter.getOperationCount(nid, 'contact_sync'));
    }));

    return accounts.map((a) => {
      const live = zaloPool.getStatus(a.id) ?? a.status;
      const u = uptimeMap.get(a.id);
      const uptime7d = u?.uptimePct ?? 0;
      const todayMetrics: NickDayMetrics | undefined = metricsToday.get(a.id);
      // 2026-06-06 (Anh chốt) — "Msg today" CHỈ đếm tin GỬI ĐI cho NGƯỜI LẠ (bị cap).
      // Bạn bè + tin nhận KHÔNG tính. So với dailyStrangerMessageCap của nick.
      const msgToday = todayMetrics?.msgSentToStrangers ?? 0;
      const lastActivity = lastActivityMap.get(a.id) ?? a.lastConnectedAt;
      // Owner's department — FE dùng cho cột Department + filter chip Phòng ban.
      const ownerDept = a.owner?.departmentMember?.department ?? null;

      return {
        id: a.id,
        zaloUid: a.zaloUid,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        phone: a.phone,
        status: a.status,
        liveStatus: live,
        hasProxy: !!a.proxyUrl,
        lastConnectedAt: a.lastConnectedAt,
        disconnectedAt: a.disconnectedAt,        // mốc mất kết nối (FE đếm passive / hiện manual)
        disconnectReason: a.disconnectReason,    // 'manual' | 'passive' | null
        createdAt: a.createdAt,
        owner: a.owner ? { id: a.owner.id, fullName: a.owner.fullName, email: a.owner.email } : null,
        ownerUserId: a.ownerUserId,
        ownerDepartment: ownerDept,
        ownerDeptRole: a.owner?.departmentMember?.deptRole ?? null,
        // Phase Privacy v2 2026-05-23 — nick là internal contact của user nào (thường = owner).
        // FE render badge "🏠 Liên lạc nội bộ" trong owner cell.
        isInternalContactFor: a.internalContactForUsers?.[0] ?? null,
        privacyMode: a.privacyMode,
        // RBAC 2026-05-22: gate Action buttons trên frontend
        canManage: canManageAccount(a.ownerUserId, userId, user.role),
        isOwnedByMe: a.ownerUserId === userId,
        // Multi-sale crew with role mapping → UI badges (admin=Owner, chat=Editor, read=Viewer)
        crew: a.access.map((ac) => ({
          accessId: ac.id,
          permission: ac.permission,
          role: ac.permission === 'admin' ? 'owner' : ac.permission === 'chat' ? 'editor' : 'viewer',
          user: ac.user,
        })),
        crewCount: a.access.length,
        // Metrics — 2026-06-06: msgToday = gửi-người-lạ, quota = cap người lạ của nick.
        msgToday,
        quota: a.dailyStrangerMessageCap ?? 300,
        uptime7d,
        lastActivityAt: lastActivity,
        // Phase metrics layer 2026-05-22: breakdown chi tiết per nick today.
        // FE dashboard + automation gate đều consume field này.
        metricsToday: todayMetrics ? {
          msgReceivedFromFriends: todayMetrics.msgReceivedFromFriends,
          msgReceivedFromStrangers: todayMetrics.msgReceivedFromStrangers,
          msgSentByUser: todayMetrics.msgSentByUser,
          msgSentByBot: todayMetrics.msgSentByBot,
          msgSentToStrangers: todayMetrics.msgSentToStrangers,
          msgSentToFriends: todayMetrics.msgSentToFriends,
          friendReqSent: todayMetrics.friendReqSent,
          friendReqAccepted: todayMetrics.friendReqAccepted,
          friendReqRejected: todayMetrics.friendReqRejected,
          phoneSearchTotal: todayMetrics.phoneSearchTotal,
          phoneSearchFoundZalo: todayMetrics.phoneSearchFoundZalo,
          phoneSearchNoZalo: todayMetrics.phoneSearchNoZalo,
        } : null,
        // 2026-06-06 — SDK counts/ngày cho bảng ma trận (Redis rate-limiter).
        // sdkCounts: { friend_read, friend_action, message, ... } · sdkTotal: tổng gộp.
        sdkCounts: sdkCountsMap.get(a.id) ?? {},
        sdkTotal: Object.values(sdkCountsMap.get(a.id) ?? {}).reduce((s, n) => s + n, 0),
        contactSyncToday: contactSyncMap.get(a.id) ?? 0,
        // E3: health alert badge when uptime under 80% in the 7-day window
        healthAlert: uptime7d < 80,
      };
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // PATCH /api/v1/zalo-accounts/:id/owner — re-assign owner
  // Phase ZaloAccounts redesign 2026-05-22.
  // Permission: org admin/owner HOẶC current owner (chuyển nhượng chính chủ).
  // Side effect: revoke ALL active privacy sessions của owner cũ — tránh owner
  // cũ vẫn unlock được data của nick sau khi mất quyền.
  // ───────────────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { newOwnerUserId: string } }>(
    '/api/v1/zalo-accounts/:id/owner',
    async (request, reply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params;
      const { newOwnerUserId } = request.body ?? ({} as any);

      if (!newOwnerUserId || typeof newOwnerUserId !== 'string') {
        return reply.status(400).send({ error: 'newOwnerUserId required' });
      }

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, ownerUserId: true, displayName: true },
      });
      if (!account) return reply.status(404).send({ error: 'Account not found' });

      // Permission gate (Anh siết 2026-06-11): CHỈ chủ tổ chức (role='owner') được chuyển
      // giao nick. Trước cho admin + chính-chủ-nick → nay siết để chống lạm quyền + đúng
      // luồng "giao số A→B do chủ tổ chức quyết". Chi tiết: 3 fix quét/trùng nick Zalo.
      if (user.role !== 'owner') {
        return reply.status(403).send({
          error: 'Chỉ chủ tổ chức mới được chuyển giao (re-assign) nick',
          code: 'only_org_owner',
        });
      }

      // Verify new owner tồn tại trong cùng org.
      const newOwner = await prisma.user.findFirst({
        where: { id: newOwnerUserId, orgId: user.orgId },
        select: { id: true, fullName: true, email: true },
      });
      if (!newOwner) {
        return reply.status(400).send({ error: 'newOwnerUserId không thuộc org' });
      }

      // No-op nếu chính chủ không đổi.
      if (account.ownerUserId === newOwnerUserId) {
        return reply.send({ ok: true, noop: true });
      }

      const oldOwnerId = account.ownerUserId;

      await tenantTransaction(async (tx) => {
        await tx.zaloAccount.update({
          where: { id },
          data: { ownerUserId: newOwnerUserId },
        });
        // 2026-06-11: cấp quyền admin cho chủ MỚI trong ACL + gỡ chủ cũ — để chủ mới quản
        // được nick ngay (nhất quán với POST /zalo-accounts auto-insert access cho owner).
        await tx.zaloAccountAccess.upsert({
          where: { zaloAccountId_userId: { zaloAccountId: id, userId: newOwnerUserId } },
          create: { zaloAccountId: id, userId: newOwnerUserId, permission: 'admin' },
          update: { permission: 'admin' },
        });
        if (oldOwnerId) {
          await tx.zaloAccountAccess.deleteMany({ where: { zaloAccountId: id, userId: oldOwnerId } });
        }
        // Phase Privacy v2 2026-05-23: cascade clear internalContactZaloAccountId của owner cũ
        // nếu trỏ tới nick này — sale cũ không còn own → phải re-pick.
        await tx.user.updateMany({
          where: { internalContactZaloAccountId: id },
          data: { internalContactZaloAccountId: null },
        });
      });

      // Side effect: revoke ALL privacy sessions của owner cũ.
      // Phòng trường hợp owner cũ vẫn còn cookie HttpOnly từ session unlock trước.
      // Lỗi revoke không block — nick đã đổi owner trong DB.
      try {
        await revokeAllSessions(oldOwnerId);
      } catch (err) {
        logger.warn(`[zalo-owner-reassign] revokeAllSessions(${oldOwnerId}) failed: ${String(err)}`);
      }

      logger.info(
        `[zalo-owner-reassign] account=${id} from=${oldOwnerId} to=${newOwnerUserId} by=${userId}`,
      );

      return reply.send({
        ok: true,
        accountId: id,
        oldOwnerUserId: oldOwnerId,
        newOwnerUserId,
        newOwner: { id: newOwner.id, fullName: newOwner.fullName, email: newOwner.email },
      });
    },
  );

  // ───────────────────────────────────────────────────────────────────
  // GET /api/v1/zalo-accounts/:id/uptime?range=7d — sparkline data
  // Returns N buckets of {date, msgSent, msgReceived, hasActivity}
  // ───────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    '/api/v1/zalo-accounts/:id/uptime',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      const range = request.query.range ?? '7d';
      const n = range === '24h' ? 1 : range === '30d' ? 30 : 7;

      // Phase Zalo Account Mutation Gate 2026-05-27: read scope (trưởng phòng OK qua dept cascade)
      const gate = await requireAccountVisible(request, reply, id);
      if (!gate) return reply;

      const { start, days } = lastNDays(n);
      const today = startOfDay(new Date());

      const rows = await prisma.dailyMessageStat.groupBy({
        by: ['statDate'],
        where: { orgId: user.orgId, zaloAccountId: id, statDate: { gte: start, lte: today } },
        _sum: { messagesSent: true, messagesReceived: true },
      });

      const byDate = new Map(
        rows.map((r) => [
          r.statDate.toISOString().slice(0, 10),
          {
            sent: r._sum.messagesSent ?? 0,
            received: r._sum.messagesReceived ?? 0,
          },
        ]),
      );

      const buckets = days.map((date) => {
        const v = byDate.get(date);
        const msgSent = v?.sent ?? 0;
        const msgReceived = v?.received ?? 0;
        return { date, msgSent, msgReceived, hasActivity: msgSent + msgReceived > 0 };
      });

      const activeDays = buckets.filter((b) => b.hasActivity).length;
      const uptimePct = Number(((activeDays / n) * 100).toFixed(1));

      return { range, buckets, uptimePct };
    },
  );

  // ───────────────────────────────────────────────────────────────────
  // POST /api/v1/zalo-accounts/bulk-action — reconnect / sync / disable many
  // Owner/admin only — sync-contacts and disable can be destructive.
  // ───────────────────────────────────────────────────────────────────
  app.post<{ Body: { ids: string[]; action: string } }>(
    '/api/v1/zalo-accounts/bulk-action',
    { preHandler: requireGrant('zalo_account', 'edit') },
    async (request, reply) => {
      const user = request.user!;
      const { ids, action } = request.body ?? { ids: [], action: '' };

      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids[] is required' });
      }
      if (!['reconnect', 'sync-contacts', 'disable'].includes(action)) {
        return reply.status(400).send({ error: 'action must be reconnect | sync-contacts | disable' });
      }

      // Scope to caller's org so a malicious payload can't target other orgs' accounts
      const accounts = await prisma.zaloAccount.findMany({
        where: { id: { in: ids }, orgId: user.orgId },
      });

      const results: Array<{ id: string; ok: boolean; error?: string }> = [];

      for (const a of accounts) {
        try {
          if (action === 'reconnect') {
            const session = a.sessionData as { cookie: any; imei: string; userAgent: string } | null;
            if (!session?.imei) {
              results.push({ id: a.id, ok: false, error: 'no saved session' });
              continue;
            }
            // Fire-and-forget; status delivered via Socket.IO
            zaloPool.reconnect(a.id, session, a.proxyUrl).catch(() => {});
            results.push({ id: a.id, ok: true });
          } else if (action === 'sync-contacts') {
            // Defer to existing sync-contacts route via internal HTTP would be circular —
            // we just mark intent; the heavy lifting is best done by hitting the per-account
            // route from FE in parallel. Here we no-op success so FE can fan out.
            results.push({ id: a.id, ok: true });
          } else if (action === 'disable') {
            // NGẮT THỦ CÔNG (2026-06-16): set reason='manual' + mốc ngắt → cron/autoReconnect
            // BỎ QUA nick này (ngắt là ngắt thật, KHÔNG tự nối lại). GIỮ session để "Kết nối lại"
            // (sale sẽ quét QR lại — Anh chốt). disconnectedAt = mốc cố định FE hiện "Đã ngắt lúc…".
            zaloPool.disconnect(a.id);
            await prisma.zaloAccount.update({
              where: { id: a.id },
              data: { status: 'disconnected', disconnectReason: 'manual', disconnectedAt: new Date() },
            });
            results.push({ id: a.id, ok: true });
          }
        } catch (err: any) {
          results.push({ id: a.id, ok: false, error: err.message ?? 'unknown' });
        }
      }

      logger.info(
        `Bulk action ${action} on ${results.length} accounts by ${user.email}: ` +
          `${results.filter((r) => r.ok).length} ok, ${results.filter((r) => !r.ok).length} failed`,
      );

      return {
        action,
        total: ids.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // TRẦN SDK ZALO (2026-06-06 Anh chốt) — org default + per-nick override.
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/v1/zalo-accounts/sdk-limits — trần org default + danh sách nick override.
  // GET để MỞ (read-only): cột "SDK/Giới hạn hôm nay" ở trang Zalo dùng nó hiện usage/limit cho
  // sale. Chỉ CHẶN sửa: PUT/DELETE dưới gate 'settings:edit' (2026-06-18) → sale ko đổi được trần.
  app.get('/api/v1/zalo-accounts/sdk-limits', async (request) => {
    const user = request.user!;
    const rows = await prisma.sdkLimit.findMany({
      where: { orgId: user.orgId },
      select: { zaloAccountId: true, category: true, dailyLimit: true, burstLimit: true, burstWindowMs: true },
    });
    // org default: ưu tiên hàng DB; thiếu category nào → fallback hằng số.
    const orgDefault: Record<string, { daily: number; burst: number; burstWindowMs: number }> = {};
    for (const cat of ALL_CATEGORIES) {
      const row = rows.find((r) => r.zaloAccountId === null && r.category === cat);
      orgDefault[cat] = row
        ? { daily: row.dailyLimit, burst: row.burstLimit, burstWindowMs: row.burstWindowMs }
        : { daily: DEFAULT_SDK_LIMITS[cat].daily, burst: DEFAULT_SDK_LIMITS[cat].burst, burstWindowMs: DEFAULT_SDK_LIMITS[cat].burstWindowMs };
    }
    // per-nick override: gom theo nick → { category: {...} }
    const nickOverrides: Record<string, Record<string, { daily: number; burst: number; burstWindowMs: number }>> = {};
    for (const r of rows) {
      if (!r.zaloAccountId) continue;
      (nickOverrides[r.zaloAccountId] ??= {})[r.category] = {
        daily: r.dailyLimit, burst: r.burstLimit, burstWindowMs: r.burstWindowMs,
      };
    }
    // 2026-06-18: kèm danh sách nick (id + tên) để trang Cài đặt "Trần SDK" đổ vào tab "Theo nick"
    // mà KHÔNG phải gọi /zalo-accounts (tách phụ thuộc quyền zalo_account).
    const nicks = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId, archivedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
    return { categories: ALL_CATEGORIES, orgDefault, nickOverrides, nicks };
  });

  // PUT /api/v1/zalo-accounts/sdk-limits/org — owner/admin lưu trần org default.
  // Body: { limits: { [category]: { daily, burst, burstWindowMs? } } }
  app.put(
    '/api/v1/zalo-accounts/sdk-limits/org',
    { preHandler: requireGrant('settings', 'edit') }, // 2026-06-18: chỉ admin Cài đặt (sale ko đổi trần)
    async (request, reply) => {
      const user = request.user!;
      const body = (request.body ?? {}) as { limits?: Record<string, { daily?: number; burst?: number; burstWindowMs?: number }> };
      const limits = body.limits ?? {};
      // Validate + resolve existing rows OUTSIDE tx (early-return cho validation, NULL không
      // dùng được composite upsert nên findFirst + update/create).
      const actions: Array<{ existingId: string | null; cat: string; daily: number; burst: number; win: number }> = [];
      for (const cat of ALL_CATEGORIES) {
        const v = limits[cat];
        if (!v) continue;
        const daily = Number(v.daily);
        const burst = Number(v.burst);
        const win = Number(v.burstWindowMs ?? DEFAULT_SDK_LIMITS[cat].burstWindowMs);
        if (!Number.isFinite(daily) || daily < 0 || daily > 100000)
          return reply.status(400).send({ error: `${cat}_daily_invalid`, hint: 'daily 0..100000' });
        if (!Number.isFinite(burst) || burst < 0 || burst > 1000)
          return reply.status(400).send({ error: `${cat}_burst_invalid`, hint: 'burst 0..1000' });
        const existing = await prisma.sdkLimit.findFirst({
          where: { orgId: user.orgId, zaloAccountId: null, category: cat },
          select: { id: true },
        });
        actions.push({ existingId: existing?.id ?? null, cat, daily, burst, win });
      }
      await tenantTransaction(async (tx) => {
        for (const a of actions) {
          if (a.existingId) {
            await tx.sdkLimit.update({ where: { id: a.existingId }, data: { dailyLimit: a.daily, burstLimit: a.burst, burstWindowMs: a.win } });
          } else {
            await tx.sdkLimit.create({ data: { orgId: user.orgId, zaloAccountId: null, category: a.cat, dailyLimit: a.daily, burstLimit: a.burst, burstWindowMs: a.win } });
          }
        }
      });
      invalidateLimitCache(user.orgId);
      logger.info(`[sdk-limits] org default updated by ${user.email}`);
      return { ok: true };
    },
  );

  // PUT /api/v1/zalo-accounts/:id/sdk-limits — ghi đè trần cho 1 nick.
  // Body: { limits: { [category]: { daily, burst, burstWindowMs? } | null } } (null = xoá override category đó)
  app.put(
    '/api/v1/zalo-accounts/:id/sdk-limits',
    { preHandler: requireGrant('settings', 'edit') }, // 2026-06-18: chỉ admin Cài đặt (sale ko đổi trần)
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const nick = await prisma.zaloAccount.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!nick) return reply.status(404).send({ error: 'nick_not_found' });
      const body = (request.body ?? {}) as { limits?: Record<string, { daily?: number; burst?: number; burstWindowMs?: number } | null> };
      const limits = body.limits ?? {};
      for (const cat of ALL_CATEGORIES) {
        if (!(cat in limits)) continue;
        const v = limits[cat];
        const existing = await prisma.sdkLimit.findFirst({
          where: { orgId: user.orgId, zaloAccountId: id, category: cat }, select: { id: true },
        });
        if (v === null) {
          // xoá override → nick quay về org default
          if (existing) await prisma.sdkLimit.delete({ where: { id: existing.id } });
          continue;
        }
        const daily = Number(v.daily);
        const burst = Number(v.burst);
        const win = Number(v.burstWindowMs ?? DEFAULT_SDK_LIMITS[cat].burstWindowMs);
        if (!Number.isFinite(daily) || daily < 0 || daily > 100000)
          return reply.status(400).send({ error: `${cat}_daily_invalid` });
        if (!Number.isFinite(burst) || burst < 0 || burst > 1000)
          return reply.status(400).send({ error: `${cat}_burst_invalid` });
        if (existing) {
          await prisma.sdkLimit.update({ where: { id: existing.id }, data: { dailyLimit: daily, burstLimit: burst, burstWindowMs: win } });
        } else {
          await prisma.sdkLimit.create({ data: { orgId: user.orgId, zaloAccountId: id, category: cat, dailyLimit: daily, burstLimit: burst, burstWindowMs: win } });
        }
      }
      invalidateLimitCache(user.orgId);
      logger.info(`[sdk-limits] nick ${id} override updated by ${user.email}`);
      return { ok: true };
    },
  );

  // DELETE /api/v1/zalo-accounts/:id/sdk-limits — xoá HẾT override của nick (về org default).
  app.delete(
    '/api/v1/zalo-accounts/:id/sdk-limits',
    { preHandler: requireGrant('settings', 'edit') }, // 2026-06-18: chỉ admin Cài đặt (sale ko đổi trần)
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      await prisma.sdkLimit.deleteMany({ where: { orgId: user.orgId, zaloAccountId: id } });
      invalidateLimitCache(user.orgId);
      return { ok: true };
    },
  );
}
